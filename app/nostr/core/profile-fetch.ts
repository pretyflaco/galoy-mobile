/**
 * Profile avatar fetch (kind-0 `picture`) — the same recipe Amber/Amethyst use, minimized for a
 * signer that only needs ITS OWN npub's avatar.
 *
 * Given the user's x-only pubkey (hex), query the profile indexer relays with the filter
 * `{ kinds:[0], authors:[pubkeyHex], limit:1 }`, take the newest kind-0 event (replaceable), parse
 * its `content` JSON, and return a whitelisted `picture` URL (http(s) only). Everything is
 * defensive and metadata-only: no secret is ever touched (leak-audit safe). A missing/blank/bad
 * picture, a timeout, or a fetch error all yield `null` — the caller falls back to the identicon.
 *
 * AD-1: core is UI-free. The relay pool is injected (the runtime's single pool) so this is
 * unit-testable without a socket. AD-11 note: this uses PROFILE_INDEXER_RELAYS (a documented
 * discovery exception), never the NIP-46 transport relay set.
 */
import { PROFILE_INDEXER_RELAYS } from "./profile-relays"

/** The narrow pool surface this fetch needs (a subset of the runtime RelayPool). */
export interface ProfileFetchPool {
  get(
    relays: string[],
    filter: Record<string, unknown>,
    params?: { maxWait?: number },
  ): Promise<unknown | null>
}

/** Bounded wait for the profile fetch (public relays; keep it snappy). */
export const PROFILE_FETCH_MAX_WAIT_MS = 4000

const MAX_URL_LEN = 2048

/** Accept only a plausible http(s) image URL; reject blanks, "null", non-http, over-long. */
const sanitizePictureUrl = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.length > MAX_URL_LEN) {
    return null
  }
  try {
    const u = new URL(trimmed)
    return u.protocol === "https:" || u.protocol === "http:" ? trimmed : null
  } catch {
    return null
  }
}

/**
 * Fetch the `picture` URL from a pubkey's newest kind-0 event, or null. `relays` defaults to the
 * profile indexer set; the pool + relays are injectable for tests.
 */
export const fetchProfilePicture = async (
  pubkeyHex: string,
  pool: ProfileFetchPool,
  relays: readonly string[] = PROFILE_INDEXER_RELAYS,
): Promise<string | null> => {
  if (!/^[0-9a-f]{64}$/i.test(pubkeyHex)) return null
  try {
    const event = (await pool.get(
      [...relays],
      { kinds: [0], authors: [pubkeyHex.toLowerCase()], limit: 1 },
      { maxWait: PROFILE_FETCH_MAX_WAIT_MS },
    )) as { content?: unknown } | null
    if (!event || typeof event.content !== "string") return null
    const meta = JSON.parse(event.content) as Record<string, unknown>
    return sanitizePictureUrl(meta?.picture)
  } catch {
    return null
  }
}
