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
 *                         grant includes `sign_event:22242` → satisfied WITHOUT a second modal
 *                         (single-approval login, AC #8 / CAP-4). The ONLY cached consent.
 *  - `needs-approval`   : a connected client whose request is not covered by the fixed grant →
 *                         raise a fresh approval (every request approved except the grant).
 *
 * AD-1: core is UI-free.
 */
import { GRANTABLE_SCOPE, type ConnectionStore } from "./connection-store"

/** The kind whose signature the fixed connect-time grant covers (auth challenge). */
export const AUTH_CHALLENGE_KIND = 22242

export type PolicyDecision =
  | "drop-silent"
  | "error-disconnected"
  | "pre-approved"
  | "needs-approval"

/** Minimal request shape the policy inspects (method + optional event kind). */
export interface PolicyRequest {
  method: string
  kind?: number
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

  // Single-approval login: the fixed sign_event:22242 grant covers a kind-22242 sign_event
  // and nothing else. Everything outside that exact match raises a fresh approval.
  const isAuthChallengeSign =
    request.method === "sign_event" && request.kind === AUTH_CHALLENGE_KIND
  if (isAuthChallengeSign && (await store.hasGrant(clientPubkey, GRANTABLE_SCOPE))) {
    return "pre-approved"
  }

  return "needs-approval"
}
