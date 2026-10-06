/**
 * Profile (kind-0) indexer relays.
 *
 * DELIBERATE AD-11 EXCEPTION: the signer's transport relays come ONLY from the nostrconnect://
 * URI (never a hardcoded global list). Profile DISCOVERY is different — to show the user's own
 * avatar we must fetch their kind-0 metadata from public profile aggregators, exactly as Amber
 * and Amethyst do. This set is used SOLELY for the read-only kind-0 profile fetch and NEVER for
 * NIP-46 request/response transport.
 *
 * The hosts are the intersection of Amber's `defaultIndexerRelays` and Amethyst's
 * `DefaultIndexerRelayList` — dedicated profile aggregators that carry everyone's latest kind-0.
 * `purplepag.es` alone usually suffices; we query several in parallel for reliability.
 */
export const PROFILE_INDEXER_RELAYS: readonly string[] = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://profiles.nostr1.com",
  "wss://directory.yabu.me",
]
