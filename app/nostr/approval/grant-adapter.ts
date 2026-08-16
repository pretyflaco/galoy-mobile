/**
 * Grant-coverage adapter (Story 3.4 Task 2 / AD-9).
 *
 * Centralizes the "is this covered by the connect-time grant?" predicate: it derives the
 * coordinator's `isCoveredByGrant` from `evaluateRequestPolicy` (PolicyCheck, Story 3.3) so the
 * pipeline and the coordinator share ONE definition of the fixed grant. Only a request whose
 * PolicyCheck decision is `pre-approved` (a kind-22242 `sign_event` on a connection that granted
 * `sign_event:22242`) is covered; connection-approval entries always raise a surface.
 *
 * AD-1: this module is UI-free.
 */
import type { ApprovalEntry } from "./coordinator"
import { evaluateRequestPolicy } from "@app/nostr/core/policy-check"
import type { ConnectionStore } from "@app/nostr/core/connection-store"

/**
 * Build the coordinator's `isCoveredByGrant` from the shared PolicyCheck. Returns true only
 * when the entry is a request the connect-time grant pre-approves (single-approval login).
 */
export const grantCoverageFromPolicy =
  (store: ConnectionStore) =>
  async (entry: ApprovalEntry): Promise<boolean> => {
    if (entry.kind !== "request") return false
    const decision = await evaluateRequestPolicy(store, entry.clientPubkey, {
      method: entry.method,
      kind: entry.eventKind,
    })
    return decision === "pre-approved"
  }
