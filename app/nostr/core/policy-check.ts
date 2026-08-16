/**
 * PolicyCheck (Story 3.3 / AD-8) — decides how an inbound (non-connect) request is handled.
 *
 * Reads ONLY the ConnectionStore (AD-8 single-owner rule) — no separate policy store, no
 * "remember this app", no configurable rules. The decision is exactly one of:
 *
 *  - `drop-silent`   : the client has no ConnectionStore record → dropped WITHOUT response
 *                      (no npub disclosure, no liveness oracle) — AC #7.
 *  - `pre-approved`  : a kind-22242 auth-challenge `sign_event` on a connection whose grant
 *                      includes `sign_event:22242` → satisfied WITHOUT a second modal
 *                      (single-approval login, AC #8 / CAP-4). This is the ONLY cached consent.
 *  - `needs-approval`: a connected client whose request is not covered by the fixed grant →
 *                      raise a fresh approval (every request approved except the grant).
 *
 * AD-1: core is UI-free.
 */
import { GRANTABLE_SCOPE, type ConnectionStore } from "./connection-store"

/** The kind whose signature the fixed connect-time grant covers (auth challenge). */
export const AUTH_CHALLENGE_KIND = 22242

export type PolicyDecision = "drop-silent" | "pre-approved" | "needs-approval"

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
  // Never-connected → dropped without response (no oracle).
  if (!(await store.isConnected(clientPubkey))) return "drop-silent"

  // Single-approval login: the fixed sign_event:22242 grant covers a kind-22242 sign_event
  // and nothing else. Everything outside that exact match raises a fresh approval.
  const isAuthChallengeSign =
    request.method === "sign_event" && request.kind === AUTH_CHALLENGE_KIND
  if (isAuthChallengeSign && (await store.hasGrant(clientPubkey, GRANTABLE_SCOPE))) {
    return "pre-approved"
  }

  return "needs-approval"
}
