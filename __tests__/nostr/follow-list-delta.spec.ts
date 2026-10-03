/**
 * FR-25 / AD-21 — the shared kind:3 follow-list delta (moved out of runtime.ts so the NIP-46
 * and NIP-55 raise sites use ONE implementation). Bounded (≈ 3 s), fail-open, display-only;
 * a tri-state result spread onto the approval entry:
 *   delta → { followListDelta } · unavailable → { followListDeltaUnavailable } · non-kind-3 → {}.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

import {
  createFollowListDeltaReader,
  fetchFollowListDelta,
  FOLLOW_LIST_READ_BUDGET_MS,
} from "@app/nostr/approval/follow-list-delta"
import { PROFILE_INDEXER_RELAYS } from "@app/nostr/core/profile-relays"

const userPubHex = bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(7)))
const userNpub = nip19.npubEncode(userPubHex)
const RELAYS = ["wss://relay.example"]

const follows = (n: number): string[][] =>
  Array.from({ length: n }, (_, i) => ["p", `${i}`.padStart(64, "0")])
const kind3 = (pCount: number) => ({
  kind: 3,
  // Non-`p` tags are not follows and must not be counted.
  tags: [...follows(pCount), ["t", "nostr"]],
})

describe("fetchFollowListDelta", () => {
  it("returns published → proposed follow counts for a kind:3 (p tags only)", async () => {
    const get = jest.fn(async () => ({ tags: [...follows(685), ["relay", "wss://x"]] }))
    const out = await fetchFollowListDelta({
      event: kind3(1),
      userNpub,
      pool: { get },
      relays: RELAYS,
    })
    expect(out).toEqual({ followListDelta: { before: 685, after: 1 } })
    // Reads the user's OWN newest kind:3 (hex author), bounded per relay.
    expect(get).toHaveBeenCalledWith(
      RELAYS,
      { kinds: [3], authors: [userPubHex] },
      { maxWait: expect.any(Number) },
    )
  })

  it("non-kind:3 → no enrichment at all, and no network read", async () => {
    const get = jest.fn(async () => ({ tags: follows(685) }))
    for (const kind of [0, 1, 27235, 10002]) {
      const out = await fetchFollowListDelta({
        event: { kind, tags: follows(3) },
        userNpub,
        pool: { get },
        relays: RELAYS,
      })
      expect(out).toEqual({})
    }
    expect(get).not.toHaveBeenCalled()
  })

  it("no published list → unavailable (the hint, not a delta)", async () => {
    const out = await fetchFollowListDelta({
      event: kind3(1),
      userNpub,
      pool: { get: async () => null },
      relays: RELAYS,
    })
    expect(out).toEqual({ followListDeltaUnavailable: true })
  })

  it("a failing read → unavailable (fail-open, never throws)", async () => {
    const out = await fetchFollowListDelta({
      event: kind3(1),
      userNpub,
      pool: {
        get: async () => {
          throw new Error("relay down")
        },
      },
      relays: RELAYS,
    })
    expect(out).toEqual({ followListDeltaUnavailable: true })
  })

  it("a pool without a read path, or no relays → unavailable", async () => {
    expect(
      await fetchFollowListDelta({ event: kind3(1), userNpub, pool: {}, relays: RELAYS }),
    ).toEqual({ followListDeltaUnavailable: true })
    expect(
      await fetchFollowListDelta({
        event: kind3(1),
        userNpub,
        pool: { get: async () => ({ tags: follows(5) }) },
        relays: [],
      }),
    ).toEqual({ followListDeltaUnavailable: true })
  })

  it("an undecodable identity → unavailable", async () => {
    const out = await fetchFollowListDelta({
      event: kind3(1),
      userNpub: "not-an-npub",
      pool: { get: async () => ({ tags: follows(5) }) },
      relays: RELAYS,
    })
    expect(out).toEqual({ followListDeltaUnavailable: true })
  })

  describe("bounded (AD-21 ≈ 3 s)", () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it("a read that never answers resolves unavailable at the budget, not later", async () => {
      const never = new Promise<null>(() => {
        // never settles — a relay that answers neither EOSE nor an event
      })
      let settled: unknown = "pending"
      fetchFollowListDelta({
        event: kind3(1),
        userNpub,
        pool: { get: () => never },
        relays: RELAYS,
      }).then((out) => {
        settled = out
      })

      await jest.advanceTimersByTimeAsync(FOLLOW_LIST_READ_BUDGET_MS - 1)
      expect(settled).toBe("pending")
      await jest.advanceTimersByTimeAsync(1)
      expect(settled).toEqual({ followListDeltaUnavailable: true })
      expect(FOLLOW_LIST_READ_BUDGET_MS).toBeLessThanOrEqual(3_000)
    })

    it("a successful read clears the budget timer (nothing left pending)", async () => {
      await fetchFollowListDelta({
        event: kind3(1),
        userNpub,
        pool: { get: async () => ({ tags: follows(2) }) },
        relays: RELAYS,
      })
      expect(jest.getTimerCount()).toBe(0)
    })
  })
})

describe("createFollowListDeltaReader", () => {
  it("reads the connection relays when there are any", async () => {
    const get = jest.fn(async (_relays: string[]) => ({ tags: follows(4) }))
    const read = createFollowListDeltaReader({ pool: { get }, relays: () => RELAYS })
    expect(await read(kind3(2), userNpub)).toEqual({
      followListDelta: { before: 4, after: 2 },
    })
    expect(get.mock.calls[0][0]).toEqual(RELAYS)
  })

  it("falls back to the profile relay set when there are none (e.g. NIP-55)", async () => {
    const get = jest.fn(async (_relays: string[]) => ({ tags: follows(4) }))
    const read = createFollowListDeltaReader({ pool: { get }, relays: () => [] })
    await read(kind3(2), userNpub)
    expect(get.mock.calls[0][0]).toEqual([...PROFILE_INDEXER_RELAYS])
  })

  it("resolves the relays per call (a later connection's relays are used)", async () => {
    const get = jest.fn(async (_relays: string[]) => ({ tags: follows(4) }))
    let relays: string[] = []
    const read = createFollowListDeltaReader({ pool: { get }, relays: () => relays })
    relays = ["wss://later.example"]
    await read(kind3(2), userNpub)
    expect(get.mock.calls[0][0]).toEqual(["wss://later.example"])
  })
})
