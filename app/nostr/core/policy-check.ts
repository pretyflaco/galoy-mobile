/**
 * PolicyCheck (Story 3.3 / AD-8) — decides how an inbound (non-connect) request is handled.
 *
 * Reads ONLY the ConnectionStore (AD-8 single-owner rule) — no separate policy store, no
 * "remember this app", no configurable rules. The decision is exactly one of:
 *
 *  - `drop-silent`      : the client has NEVER been connected → dropped WITHOUT response
 *                         (no npub disclosure, no liveness oracle) — AC #7.
 *  - `error-disconnected`: the client was previously connected and is now TOMBSTONED
 *                         (disconnected) → a spec-appropriate error reply so it learns it was
 *                         disconnected; a later kind-22242 is NEVER auto-honored against the
 *                         voided grant (Story 3.7 / AD-8 / AD-16). The tombstoned-vs-never
 *                         asymmetry is load-bearing.
 *  - `pre-approved`     : a kind-22242 auth-challenge `sign_event` on a LIVE connection whose
 *                         grant includes `sign_event:22242`; OR a kind-27235 NIP-98 `sign_event`
 *                         whose grant includes `sign_event:27235` AND whose `u`-tag host matches
 *                         the connect-time app origin → satisfied WITHOUT a second modal
 *                         (single-approval login, AC #8 / CAP-4). The ONLY cached consent.
 *  - `needs-approval`   : a connected client whose request is not covered by the fixed grant →
 *                         raise a fresh approval (every request approved except the grant).
 *
 * AD-1: core is UI-free.
 */
import { GRANTABLE_SCOPE, type ConnectionStore } from "./connection-store"

/** The kind whose signature the fixed connect-time grant covers (auth challenge). */
export const AUTH_CHALLENGE_KIND = 22242
/** NIP-98 HTTP-auth kind: pre-approved ONLY when origin-bound (u-host == granted url host). */
export const NIP98_KIND = 27235

export type PolicyDecision =
  | "drop-silent"
  | "error-disconnected"
  | "pre-approved"
  | "needs-approval"

/** Minimal request shape the policy inspects (method + optional event kind + u-host for 27235). */
export interface PolicyRequest {
  method: string
  kind?: number
  /** For a kind-27235 sign_event: the normalized host of the event's `u` tag (else undefined). */
  uHost?: string | null
}

export const evaluateRequestPolicy = async (
  store: ConnectionStore,
  clientPubkey: string,
  request: PolicyRequest,
): Promise<PolicyDecision> => {
  if (!(await store.isConnected(clientPubkey))) {
    // Tombstoned (previously connected) → spec error reply; never-connected → silent drop.
    return (await store.isTombstoned(clientPubkey)) ? "error-disconnected" : "drop-silent"
  }

  const isSign = request.method === "sign_event"

  // Fast-path 1 (unchanged): opaque auth-challenge. The sign_event:22242 grant covers a
  // kind-22242 sign_event and nothing else.
  if (
    isSign &&
    request.kind === AUTH_CHALLENGE_KIND &&
    (await store.hasGrant(clientPubkey, GRANTABLE_SCOPE))
  ) {
    return "pre-approved"
  }

  // Fast-path 2 (NIP-98, ORIGIN-BOUND): a kind-27235 sign is pre-approved ONLY when the connection
  // holds sign_event:27235 AND the event's `u`-tag host equals the granted app origin (the host of
  // metadata.url). Missing url (grantedOrigin null), missing/mismatched u-host → per-request
  // approval. This is the load-bearing safety gate: it stops a connected client silently signing
  // HTTP auth for arbitrary URLs.
  if (
    isSign &&
    request.kind === NIP98_KIND &&
    (await store.hasGrant(clientPubkey, "sign_event:27235"))
  ) {
    const grantedHost = await store.grantedOrigin(clientPubkey)
    if (grantedHost && request.uHost && request.uHost === grantedHost) {
      return "pre-approved"
    }
    return "needs-approval"
  }

  return "needs-approval"
}
