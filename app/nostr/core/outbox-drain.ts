/**
 * Outbox drain (Story 2.2 / CAP-8 / AD-12 / A7).
 *
 * Drains the persistent single-slot npub outbox (Story 2.1) by obtaining a FRESH
 * server-issued challenge AT DRAIN TIME, signing it with the identity key via the NostrSigner
 * seam, and completing the push carrying that proof-of-possession — without any user action.
 *
 * Why fresh-at-drain (CAP-8): npubs are public, so an authenticated Blink session alone is
 * insufficient to claim an npub. The server verifies possession of the npub's private key via
 * a fresh challenge signed by that key; signing at ENQUEUE time would let a stale challenge be
 * replayed. So the challenge is fetched and signed only here, during drain.
 *
 * Joint-contract boundary (§11-5, build-but-don't-freeze): the challenge-acquisition and push
 * WIRE-FORMAT is an unfrozen joint contract (architecture + blink-lnurl-server + signer). This
 * module implements the drain MECHANICS against INJECTED ports (`getChallenge`, `signChallenge`,
 * `push`); the wire-format lives behind those ports and is frozen only when the contract is
 * agreed. There is no live endpoint and no GraphQL here (A7) — v1 acceptance is a contract/mock.
 *
 * Non-blocking (FR-9): a server rejection or a thrown transport error (endpoint absent) leaves
 * the slot pending and re-queues with backoff — never surfaced to the user, never blocking the
 * ceremony/import/signing. Only a successful push marks the slot drained.
 *
 * AD-1: core is UI-free. AD-2: signing is via the injected seam — the drain never reads the nsec.
 */
import { computeBackoffDelays } from "@app/nostr/transport/relay-pool"

import type { PersistentNpubOutbox } from "./outbox"

/** The PoP push payload (shape behind the injected port; wire-format joint-contract-owned). */
export interface PushPayload {
  npub: string
  /** The fresh server-issued challenge (fetched at drain time). */
  challenge: string
  /** The proof-of-possession: the challenge signed by the identity key via the seam. */
  proof: string
}

/**
 * Push result. `{ ok: true }` marks the slot drained. `{ ok: false }` is a server rejection
 * (e.g. stale/absent proof) — no mapping written, slot stays pending. A thrown error is a
 * transport failure (endpoint absent / network) — also retryable, slot stays pending.
 */
export type PushResult = { ok: true } | { ok: false; retryable: boolean }

/** The injected push port (unfrozen wire-format joint contract; mocked in tests). */
export type PushPort = (payload: PushPayload) => Promise<PushResult>

/** Obtain a FRESH server-issued challenge for the npub (called at drain time). */
export type GetChallengePort = (npub: string) => Promise<string>

/**
 * Sign the challenge with the identity key via the NostrSigner seam (nsec confinement, AD-2).
 * In production this adapts `signer.signEvent` (auxRand injected from quick-crypto per 3.5).
 */
export type SignChallengePort = (challenge: string) => Promise<string>

export interface OutboxDrainPorts {
  outbox: PersistentNpubOutbox
  getChallenge: GetChallengePort
  signChallenge: SignChallengePort
  push: PushPort
  /** Capped-backoff tuning (optional; sensible defaults). */
  backoff?: { baseMs: number; ceilingMs: number; attempts: number }
}

export interface OutboxDrain {
  /**
   * Attempt one drain: fresh challenge → sign → push → markDrained (on success). Idempotent,
   * supersede-safe, and NON-BLOCKING — always resolves, never throws to the caller.
   */
  drain(): Promise<void>
  /** The capped exponential backoff schedule used between failed drains. */
  backoffSchedule(): number[]
}

const DEFAULT_BACKOFF = { baseMs: 1_000, ceilingMs: 60_000, attempts: 8 }

export const createOutboxDrain = (ports: OutboxDrainPorts): OutboxDrain => {
  const { outbox, getChallenge, signChallenge, push } = ports
  const backoff = ports.backoff ?? DEFAULT_BACKOFF

  // Re-entrancy guard: overlapping triggers (Story 2.3 fires on create AND import) collapse
  // to one attempt — a drain in flight is never double-run.
  let inFlight: Promise<void> | null = null

  const runOnce = async (): Promise<void> => {
    const entry = await outbox.pending()
    if (!entry) return // idempotent no-op on an empty/drained slot

    let result: PushResult
    try {
      // Fresh challenge AT DRAIN TIME (never at enqueue) → sign via the seam → push the proof.
      const challenge = await getChallenge(entry.npub)
      const proof = await signChallenge(challenge)
      result = await push({ npub: entry.npub, challenge, proof })
    } catch {
      // Transport failure (endpoint absent / network): swallow, re-queue with backoff (FR-9).
      // Slot left pending — never surfaced, never blocking.
      return
    }

    if (result.ok) {
      // Supersede-safe: mark the DRAINED entry's seq. Story 2.1's markDrained clears ONLY if
      // that seq is still current, so a newer enqueue that raced the push is never cleared.
      await outbox.markDrained(entry.seq)
    }
    // A server rejection (result.ok === false) writes no mapping and leaves the slot pending
    // for a later attempt with a fresh challenge.
  }

  return {
    drain(): Promise<void> {
      if (inFlight) return inFlight
      inFlight = runOnce().finally(() => {
        inFlight = null
      })
      return inFlight
    },
    backoffSchedule(): number[] {
      return computeBackoffDelays(backoff)
    },
  }
}
