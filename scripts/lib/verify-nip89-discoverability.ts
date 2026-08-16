/**
 * NIP-89 discoverability verification + iOS foreground-only rollout bound (Story 4.2).
 *
 * AD-15: ops-owned, under scripts/, never in app/. This is the PURE core — a predicate over
 * fetched relay events (no network here; the fetch is the ops entrypoint's job) plus the
 * iOS-foreground-only rollout bound. Reuses the 4.1 builder constants + author cross-check.
 *
 * AC #1 ("≥1 ecosystem client lists Blink") is inherently OPERATIONAL — it needs the ad
 * published (4.1) and a real third-party kind-31990 consumer. `checkDiscoverable` verifies the
 * MECHANISM: a client consuming kind-31990 WOULD list Blink iff a kind-31990 event authored by
 * the ops identity (nostr.json cross-checked) declares the NIP-46 (`k=24133`) handler. The live
 * confirmation is a documented ops/manual gate.
 */
import {
  NIP89_HANDLER_KIND,
  NIP46_KIND,
  verifyAdvertisementAuthor,
  type NostrJson,
} from "./nip89-advertisement"

/** A fetched event (only the fields the predicate needs). */
export interface FetchedEvent {
  kind: number
  pubkey: string
  tags: string[][]
}

export interface DiscoverabilityOptions {
  /** The ops app-identity pubkey (hex) the advertisement must be authored by. */
  authorPubkey: string
  /** The Blink-controlled domain's fetched nostr.json for the author cross-check. */
  nostrJson: NostrJson
}

export interface DiscoverabilityResult {
  discoverable: boolean
  /** The matched advertisement event, if any (for operator inspection). */
  advertisement: FetchedEvent | null
}

/**
 * Pure discoverability predicate: among `events`, is there a kind-31990 advertisement authored
 * by the ops identity (nostr.json cross-checked) that declares the NIP-46 `k=24133` handler? If
 * so, an ecosystem client consuming kind-31990 would list Blink as a signer (FR-17/CAP-9). A
 * spoofed author (failing the cross-check) or a missing NIP-46 `k` tag does not count.
 */
export const checkDiscoverable = (
  events: FetchedEvent[],
  options: DiscoverabilityOptions,
): DiscoverabilityResult => {
  const match = events.find((event) => {
    if (event.kind !== NIP89_HANDLER_KIND) return false
    if (event.pubkey.toLowerCase() !== options.authorPubkey.toLowerCase()) return false
    if (!verifyAdvertisementAuthor(event, options.nostrJson)) return false
    const declaresNip46 = event.tags.some(
      (tag) => tag[0] === "k" && tag[1] === String(NIP46_KIND),
    )
    return declaresNip46
  })
  return { discoverable: Boolean(match), advertisement: match ?? null }
}

/**
 * The v1 iOS rollout bound (§7 foreground-only verdict, 2026-08-14). Because Epic 4 broadens
 * ecosystem reach for an iOS-degraded capability, the advertisement's iOS expectation is bounded
 * to foreground-only: an ecosystem app sending a request to a backgrounded/locked iPhone user
 * gets NO in-background response. Encoded so the bound cannot silently drift. Android renders
 * over any app state; this bound is iOS-specific. This is why Epic 4 is the lowest v1 priority.
 */
export const IOS_FOREGROUND_ONLY_ROLLOUT_BOUND = {
  platform: "ios" as const,
  foregroundOnly: true,
  /** No in-background response to a request while the app is backgrounded/locked (v1). */
  backgroundResponse: false,
  note: "v1 iOS is foreground-only; an ecosystem request to a backgrounded iPhone user gets no in-background response. Gate/qualify rollout copy accordingly (§7 verdict).",
} as const

export interface RolloutCopyResult {
  qualified: boolean
  reason: string
}

/**
 * Guard advertisement rollout copy against promising unqualified/always-on iOS availability
 * (AC #2). Copy that implies the signer is always reachable on iPhone (e.g. "anytime",
 * "always available", "even when closed/backgrounded") is NOT qualified — it must be bounded to
 * foreground-only per the §7 verdict. Foreground-bounded or platform-neutral copy is accepted.
 */
export const qualifyRolloutCopy = (copy: string): RolloutCopyResult => {
  const lower = copy.toLowerCase()
  // Phrases implying unbounded/always-on availability that the foreground-only bound forbids.
  const unboundedClaims = [
    "anytime",
    "always available",
    "always on",
    "even when closed",
    "even when backgrounded",
    "even when locked",
    "24/7",
  ]
  const offending = unboundedClaims.find((claim) => lower.includes(claim))
  if (offending) {
    return {
      qualified: false,
      reason: `rollout copy implies unqualified always-on availability ("${offending}") — bound it to iOS foreground-only (§7 verdict)`,
    }
  }
  return { qualified: true, reason: "copy is foreground-bounded or platform-neutral" }
}
