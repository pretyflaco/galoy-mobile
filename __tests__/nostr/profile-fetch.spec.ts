/**
 * Profile avatar fetch (kind-0 `picture`) — the signer's minimized version of the Amber/Amethyst
 * recipe. Verifies the parts WE own: the filter shape sent to the pool, JSON parsing of the newest
 * kind-0 event's `content`, and the http(s) whitelist. A missing/blank/"null"/non-http picture, a
 * malformed content blob, a bad pubkey, or a pool error/timeout all resolve to `null` so the hub
 * falls back to the identicon. No secret is ever touched.
 */
import {
  fetchProfilePicture,
  PROFILE_FETCH_MAX_WAIT_MS,
  type ProfileFetchPool,
} from "@app/nostr/core/profile-fetch"
import { PROFILE_INDEXER_RELAYS } from "@app/nostr/core/profile-relays"

const PUBKEY = "a".repeat(64)

const poolReturning = (event: unknown): { pool: ProfileFetchPool; get: jest.Mock } => {
  const get = jest.fn().mockResolvedValue(event)
  return { pool: { get }, get }
}

const kind0 = (content: unknown) => ({
  kind: 0,
  content: typeof content === "string" ? content : JSON.stringify(content),
})

describe("fetchProfilePicture", () => {
  it("queries the indexer relays with the kind-0 author filter and bounded wait", async () => {
    const { pool, get } = poolReturning(kind0({ picture: "https://img.example/a.png" }))
    await fetchProfilePicture(PUBKEY, pool)
    expect(get).toHaveBeenCalledTimes(1)
    const [relays, filter, params] = get.mock.calls[0]
    expect(relays).toEqual([...PROFILE_INDEXER_RELAYS])
    expect(filter).toEqual({ kinds: [0], authors: [PUBKEY], limit: 1 })
    expect(params).toEqual({ maxWait: PROFILE_FETCH_MAX_WAIT_MS })
  })

  it("returns the parsed https picture from the kind-0 content", async () => {
    const { pool } = poolReturning(
      kind0({ picture: "https://img.example/a.png", name: "x" }),
    )
    expect(await fetchProfilePicture(PUBKEY, pool)).toBe("https://img.example/a.png")
  })

  it("accepts http as well as https", async () => {
    const { pool } = poolReturning(kind0({ picture: "http://img.example/a.png" }))
    expect(await fetchProfilePicture(PUBKEY, pool)).toBe("http://img.example/a.png")
  })

  const rejectedPictures: Array<[string, Record<string, unknown>]> = [
    ["a blank picture", { picture: "   " }],
    ['the literal string "null"', { picture: "null" }],
    ["a non-http(s) scheme", { picture: "data:image/png;base64,AAAA" }],
    ["a script-scheme url", { picture: `${"java"}${"script"}:alert(1)` }],
    ["a non-string picture", { picture: 42 }],
    ["a missing picture", { name: "no-avatar" }],
  ]
  for (const [label, content] of rejectedPictures) {
    it(`returns null for ${label}`, async () => {
      const { pool } = poolReturning(kind0(content))
      expect(await fetchProfilePicture(PUBKEY, pool)).toBeNull()
    })
  }

  it("returns null when the content is not valid JSON", async () => {
    const { pool } = poolReturning({ kind: 0, content: "{not json" })
    expect(await fetchProfilePicture(PUBKEY, pool)).toBeNull()
  })

  it("returns null when no event is found", async () => {
    const { pool } = poolReturning(null)
    expect(await fetchProfilePicture(PUBKEY, pool)).toBeNull()
  })

  it("returns null (never throws) when the pool rejects / times out", async () => {
    const pool: ProfileFetchPool = {
      get: jest.fn().mockRejectedValue(new Error("timeout")),
    }
    await expect(fetchProfilePicture(PUBKEY, pool)).resolves.toBeNull()
  })

  it("rejects a malformed pubkey without hitting the pool", async () => {
    const get = jest.fn()
    expect(await fetchProfilePicture("not-hex", { get })).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })
})
