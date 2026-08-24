/**
 * Nostr identity state + the creation-ceremony controller (Story 1.5).
 *
 * This is the framework-agnostic core the three ceremony screens drive (AD-1: no
 * React/UI here). It encodes the deliberate three-step flow and its invariants:
 *  - no key is generated on intro mount; generation happens ONLY on confirm (SM-C1/AD-6);
 *  - confirm fails closed if the CSPRNG throws — no key, no partial state (AD-6);
 *  - commit runs inside an AD-9 exclusive section (coordinator paused, epoch re-checked);
 *  - after commit the npub is pushed to the outbox, non-blocking — push failure is
 *    swallowed and never blocks completion (AD-12).
 *
 * The screens own presentation/copy/analytics; this owns the state transitions and the
 * commit/push orchestration so they are unit-testable without the RN render stack.
 */
import { bytesToHex } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

import { makeSignerError, type SignerError } from "./signer"

export type CeremonyStep = "intro" | "confirm" | "result" | "error"

/** Committed identity record (epoch bumps on every identity mutation, AD-9). */
export interface NostrIdentity {
  pubKeyHex: string
  npub: string
  epoch: number
}

export interface CeremonyState {
  step: CeremonyStep
  identity: NostrIdentity | null
  error: SignerError | null
}

export const initialCeremonyState = (): CeremonyState => ({
  step: "intro",
  identity: null,
  error: null,
})

/** Ports the ceremony depends on — injected so the flow is testable and seam-clean. */
export interface CeremonyPorts {
  /**
   * Story 1.2 keygen (throws fail-closed on CSPRNG failure). May be async so a
   * self-custodial session can resolve its mnemonic and derive NIP-06 — the await is
   * still inside the confirm action; no key material exists before it.
   */
  generateKey():
    | { privKeyHex: string; pubKeyHex: string }
    | Promise<{ privKeyHex: string; pubKeyHex: string }>
  /** Persist the identity secret (Story 1.3 keychain path). */
  persistNsec(privKeyHex: string): Promise<void>
  /** Encode an x-only pubkey hex to npub (nip19 at the edge). */
  toNpub(pubKeyHex: string): string
  /** AD-9 exclusive section: pause coordinator + hold pipeline while `commit` runs. */
  runExclusive<T>(commit: () => Promise<T>): Promise<T>
  /** Persist the committed identity + return the new epoch. */
  commitIdentity(identity: Omit<NostrIdentity, "epoch">): Promise<number>
  /** Non-blocking npub outbox push (AD-12) — may reject; caller must swallow. */
  pushNpub(npub: string): Promise<void>
}

/** Advance from intro to the confirm (agency) step. No key is generated here. */
export const toConfirm = (state: CeremonyState): CeremonyState => ({
  ...state,
  step: "confirm",
  error: null,
})

/**
 * The confirm action: generate (fail-closed), persist, commit inside the exclusive
 * section, then push the npub non-blocking. Returns the next state. On CSPRNG failure
 * returns an error state with NO identity and NO partial persistence.
 */
export const confirmCreate = async (
  state: CeremonyState,
  ports: CeremonyPorts,
): Promise<CeremonyState> => {
  let privKeyHex: string
  let pubKeyHex: string
  try {
    const key = await ports.generateKey() // throws fail-closed if the source is unavailable
    privKeyHex = key.privKeyHex
    pubKeyHex = key.pubKeyHex
  } catch (cause) {
    // Fail closed: no key, no partial state; keep the current identity unchanged.
    return {
      ...state,
      step: "error",
      error: makeSignerError("unavailable", "secure key generation failed", cause),
    }
  }

  const npub = ports.toNpub(pubKeyHex)

  // Commit inside the AD-9 exclusive section: coordinator paused, epoch re-checked.
  const identity = await ports.runExclusive(async () => {
    await ports.persistNsec(privKeyHex)
    const epoch = await ports.commitIdentity({ pubKeyHex, npub })
    return { pubKeyHex, npub, epoch }
  })

  // Non-blocking npub push (AD-12): failure must NOT block or surface in the ceremony.
  try {
    await ports.pushNpub(npub)
  } catch {
    // swallowed by design
  }

  return { step: "result", identity, error: null }
}

/** Retry after a fail-closed error returns to the confirm step (Try Again). */
export const retryAfterError = (state: CeremonyState): CeremonyState => ({
  ...state,
  step: "confirm",
  error: null,
})

// ---------------------------------------------------------------------------
// Import / replace identity (Story 1.6)
// ---------------------------------------------------------------------------

export type NsecValidation =
  | { ok: true; privKeyHex: string; npub: string }
  | { ok: false }

/**
 * Validate a pasted/scanned bech32 nsec at the import edge (AC-2). A well-formed value
 * decodes via nip19 to `{ type: 'nsec', data }`; anything else (wrong prefix, bad
 * checksum, non-nsec type, garbage) is invalid. Pure — performs NO state change.
 * bech32 is used only here; internally the key is hex lowercase.
 */
export const validateNsec = (
  input: string,
  deriveNpub: (privKeyHex: string) => string,
): NsecValidation => {
  try {
    const decoded = nip19.decode(input.trim())
    if (decoded.type !== "nsec") return { ok: false }
    const privKeyHex = bytesToHex(decoded.data as Uint8Array)
    return { ok: true, privKeyHex, npub: deriveNpub(privKeyHex) }
  } catch {
    return { ok: false }
  }
}

/** Ports the import commit depends on (AD-9 exclusive section + AD-12 monotonic push). */
export interface ImportPorts {
  persistNsec(privKeyHex: string): Promise<void>
  /** Derive the identity's x-only pubkey (hex) from the private key. */
  derivePubKeyHex(privKeyHex: string): string
  /** Encode an x-only pubkey hex to npub (nip19 at the edge). */
  toNpub(pubKeyHex: string): string
  runExclusive<T>(commit: () => Promise<T>): Promise<T>
  commitIdentity(identity: Omit<NostrIdentity, "epoch">): Promise<number>
  /**
   * Non-blocking npub push (AD-12). The monotonic seq is owned by the persistent outbox
   * (Story 2.1) — the caller supplies only the npub; a superseded/discarded-key npub can
   * never win because the outbox bumps the seq on every enqueue.
   */
  pushNpub(npub: string): Promise<void>
}

/**
 * Commit an imported nsec (already validated to hex): store it (replacing + discarding
 * the prior key — no archive), inside the AD-9 exclusive section with an epoch bump, then
 * push the new npub non-blocking (AD-12). The outbox owns the monotonic seq.
 */
export const importIdentity = async (
  privKeyHex: string,
  ports: ImportPorts,
): Promise<{ identity: NostrIdentity }> => {
  const pubKeyHex = ports.derivePubKeyHex(privKeyHex)
  const npub = ports.toNpub(pubKeyHex)

  const identity = await ports.runExclusive(async () => {
    await ports.persistNsec(privKeyHex) // overwrites nostr.nsec — replaced key discarded
    const epoch = await ports.commitIdentity({ pubKeyHex, npub })
    return { pubKeyHex, npub, epoch }
  })

  try {
    await ports.pushNpub(npub)
  } catch {
    // swallowed by design — push failure never blocks import
  }

  return { identity }
}

/**
 * AD-9 executor epoch re-check: a request approved against identity epoch N must NEVER
 * execute after the identity mutated to N+1. The executor calls this with the epoch the
 * request was approved under and the CURRENT identity epoch; a mismatch drops the request.
 */
export const executeIfEpochCurrent = <T>(
  approvedEpoch: number,
  currentEpoch: number,
  execute: () => T,
): { executed: true; value: T } | { executed: false; reason: "stale-epoch" } => {
  if (approvedEpoch !== currentEpoch) {
    return { executed: false, reason: "stale-epoch" }
  }
  return { executed: true, value: execute() }
}
