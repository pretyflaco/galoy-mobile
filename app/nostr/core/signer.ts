/**
 * NostrSigner — the single signing seam (AD-2 / AD-3 / FR-1, FR-2).
 *
 * Every consumer obtains signatures / encryption / npub through THIS port. A future
 * multi-party implementation (FrostrSigner, v2 / CAP-10) replaces the implementation
 * behind this seam with zero consumer-visible change. That is only possible if the
 * seam makes no locality assumption: every method is async, accepts an AbortSignal,
 * and fails with the SAME typed SignerError shape whether the failure is a local
 * keystore miss or a quorum timeout over relays (AD-3).
 *
 * KG-GATE (FR-2): the async / cancellable / typed-error SHAPE below is the freeze
 * surface. It is frozen as "v2-ready" only after KG sign-off. Building LocalNsecSigner
 * (Story 1.3) and Epic 3 consumers against this shape proceeds in parallel NOW; only
 * the frozen sign-off waits on KG. Do not add synchronous methods, drop AbortSignal,
 * or widen SignerError without re-review.
 *
 * AD-1: this file lives in app/nostr/core and MUST NOT import React / React Native /
 * UI. Enforced by the ESLint core-boundary override.
 */

/** The four — and only four — failure modes, identical for local and multi-party impls (AD-3). */
export type SignerErrorCode = "timeout" | "rejected" | "unavailable" | "aborted"

/** One error shape across the seam AND the pipeline. */
export interface SignerError {
  code: SignerErrorCode
  message: string
  cause?: unknown
}

/** Type guard for the typed error contract. */
export const isSignerError = (e: unknown): e is SignerError => {
  if (typeof e !== "object" || e === null) return false
  const maybe = e as { code?: unknown; message?: unknown }
  return (
    typeof maybe.message === "string" &&
    (maybe.code === "timeout" ||
      maybe.code === "rejected" ||
      maybe.code === "unavailable" ||
      maybe.code === "aborted")
  )
}

/** Constructor helper so every producer emits the identical shape. */
export const makeSignerError = (
  code: SignerErrorCode,
  message: string,
  cause?: unknown,
): SignerError => ({ code, message, cause })

/**
 * Unsigned event input (NIP-01 template). Kept minimal here; the transport/codec
 * layer owns wire encoding. `pubkey`/`id`/`sig` are added on signing.
 */
export interface EventTemplate {
  kind: number
  created_at: number
  tags: string[][]
  content: string
}

/** A fully signed NIP-01 event. */
export interface SignedEvent extends EventTemplate {
  id: string
  pubkey: string
  sig: string
}

/**
 * Custody-off-seam probe (AD-3). Custody (create / import / backup / export) is NOT
 * part of the sign/encrypt seam — it is discoverable via this capability descriptor
 * so consumers can branch without the seam ever exposing key material operations.
 */
export interface SignerCapabilities {
  /** Whether this implementation owns local key material (true for LocalNsecSigner). */
  readonly custodyLocal: boolean
  /** Whether backup/export of key material is reachable (via the backup module, not the seam). */
  readonly canBackup: boolean
  /** Whether the implementation is multi-party (true for a future FrostrSigner). */
  readonly multiParty: boolean
}

/**
 * The signing seam. Six methods, every one async and cancellable. Custody is off-seam
 * via `capabilities`. NIP-46 method names surface verbatim downstream (`sign_event`,
 * `nip44_encrypt`); the port's TS methods use the camelCase names below.
 */
// KG-GATE: the interface below (six async + AbortSignal methods, off-seam custody via
// `capabilities`, typed SignerError) is the FROZEN SURFACE per FR-2. It is frozen as
// v2-ready only after KG sign-off. Parallel dev (Story 1.3 LocalNsecSigner, Epic 3
// consumers) proceeds against this shape now; do not mutate the shape without re-review.
export interface NostrSigner {
  getPublicKey(signal?: AbortSignal): Promise<string>
  signEvent(event: EventTemplate, signal?: AbortSignal): Promise<SignedEvent>
  nip04Encrypt(pubkey: string, plaintext: string, signal?: AbortSignal): Promise<string>
  nip04Decrypt(pubkey: string, ciphertext: string, signal?: AbortSignal): Promise<string>
  nip44Encrypt(pubkey: string, plaintext: string, signal?: AbortSignal): Promise<string>
  nip44Decrypt(pubkey: string, ciphertext: string, signal?: AbortSignal): Promise<string>
  /** Custody probe — NOT a sign/encrypt method (AD-3). */
  readonly capabilities: SignerCapabilities
}
