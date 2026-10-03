/**
 * FR-25 replaceable-list shrink protection — the kind:3 follow-list delta (AD-21).
 *
 * A kind:3 is a FULL replacement list (NIP-01 replaceable kinds). A client that built its list
 * from a stale/failed relay fetch can present a near-empty one (observed 2026-09-28: Primal Web
 * sent 1 tag replacing 685 follows; the user approved the exact content and lost the list). At
 * raise time we read the user's newest PUBLISHED kind:3 and compare follow counts so the surface
 * can show "685 → 1" and warn.
 *
 * AD-21 contract, shared by EVERY raise site (NIP-46 runSignEvent and the NIP-55 handler):
 *  - display-only: the result is attached to the coordinator entry and nothing else — it never
 *    feeds PolicyCheck, the executor, the request ledger, grants, or the H3 identity/scope
 *    binding; it never auto-rejects or auto-approves;
 *  - bounded (≈ 3 s total, inside the NFR-1 budget) and fail-open;
 *  - reads only the user's own published list; carries no key material or event content.
 *
 * The result is a tri-state, spread straight onto the entry:
 *  - `{ followListDelta }`            — kind 3, published list read: before → after counts;
 *  - `{ followListDeltaUnavailable }` — kind 3, read timed out / failed / no published list:
 *                                       the surface shows a quiet "couldn't check" hint (D4b);
 *  - `{}`                             — not a kind 3: no enrichment, no hint.
 */
import * as nip19 from "nostr-tools/nip19"

import { PROFILE_INDEXER_RELAYS } from "../core/profile-relays"
import type { RelayPool } from "../transport/relay-pool"

/** The follow-list kind (NIP-02). */
export const FOLLOW_LIST_KIND = 3
/** Per-relay collection window handed to pool.get. */
export const FOLLOW_LIST_READ_MAX_WAIT_MS = 2_500
/** Hard ceiling on the whole read (AD-21 ≈ 3 s, inside NFR-1). */
export const FOLLOW_LIST_READ_BUDGET_MS = 3_000

/** The entry fields this enrichment may set (a subset of RequestApprovalEntry). */
export interface FollowListEnrichment {
  followListDelta?: { before: number; after: number }
  followListDeltaUnavailable?: true
}

const UNAVAILABLE: FollowListEnrichment = { followListDeltaUnavailable: true }

const countFollows = (tags: string[][]): number => tags.filter((t) => t[0] === "p").length

/** Resolve within the budget, else null — and never leave the race timer pending. */
const withinBudget = async <T>(work: Promise<T>): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FOLLOW_LIST_READ_BUDGET_MS)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Compare a proposed event against the user's published follow list. Non-kind-3 ⇒ `{}` without
 * touching the network; any failure for a kind 3 ⇒ `{ followListDeltaUnavailable: true }`.
 */
export const fetchFollowListDelta = async (args: {
  event: { kind: number; tags: string[][] }
  userNpub: string
  pool: Pick<RelayPool, "get">
  relays: string[]
}): Promise<FollowListEnrichment> => {
  const { event, userNpub, pool, relays } = args
  if (event.kind !== FOLLOW_LIST_KIND) return {}
  if (!pool.get || relays.length === 0) return UNAVAILABLE
  try {
    const { type, data } = nip19.decode(userNpub)
    if (type !== "npub") return UNAVAILABLE
    const current = (await withinBudget(
      pool.get(
        relays,
        { kinds: [FOLLOW_LIST_KIND], authors: [data] },
        { maxWait: FOLLOW_LIST_READ_MAX_WAIT_MS },
      ),
    )) as { tags?: string[][] } | null
    if (!current?.tags) return UNAVAILABLE
    return {
      followListDelta: {
        before: countFollows(current.tags),
        after: countFollows(event.tags),
      },
    }
  } catch {
    return UNAVAILABLE
  }
}

/** The raise-site signature: enrich one event for the identity it was raised under. */
export type FollowListDeltaReader = (
  event: { kind: number; tags: string[][] },
  userNpub: string,
) => Promise<FollowListEnrichment>

/**
 * Bind the reader to the runtime's ONE pool (AD-11) and the user's relays, resolved per call:
 * the connection relays when there are any, else the profile relay set (AD-21 / AD-20) — the
 * NIP-55 path has no connection relays, so it always reads the profile set.
 */
export const createFollowListDeltaReader =
  (deps: {
    pool: Pick<RelayPool, "get">
    relays: () => string[]
  }): FollowListDeltaReader =>
  (event, userNpub) => {
    const connectionRelays = deps.relays()
    return fetchFollowListDelta({
      event,
      userNpub,
      pool: deps.pool,
      relays:
        connectionRelays.length > 0 ? connectionRelays : [...PROFILE_INDEXER_RELAYS],
    })
  }
