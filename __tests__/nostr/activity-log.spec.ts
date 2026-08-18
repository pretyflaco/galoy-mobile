/**
 * Activity log (fix #5) — metadata-only, ring-bounded per-client history.
 *
 * The load-bearing guarantee: NOTHING but the four whitelisted metadata fields
 * (method / eventKind / time / accepted) is ever persisted, so the log is leak-audit safe even
 * if a caller passes an entry carrying content. Also verifies newest-first ordering, the ring
 * cap, per-client isolation, and the stats aggregation.
 */
import {
  createActivityLog,
  ACTIVITY_RING_SIZE,
  ACTIVITY_STORAGE_KEY,
  type ActivityStorage,
} from "@app/nostr/core/activity-log"

const memoryStorage = (): ActivityStorage & { dump: () => unknown } => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (k) => map.get(k) ?? null,
    saveJson: async (k, v) => {
      map.set(k, v)
    },
    dump: () => map.get(ACTIVITY_STORAGE_KEY),
  }
}

describe("activity log", () => {
  it("records and lists entries newest-first, isolated per client", async () => {
    const log = createActivityLog(memoryStorage())
    await log.record("A", {
      method: "sign_event",
      accepted: true,
      eventKind: 27235,
      time: 1,
    })
    await log.record("A", { method: "nip44_decrypt", accepted: false, time: 2 })
    await log.record("B", { method: "sign_event", accepted: true, time: 3 })

    const a = await log.list("A")
    expect(a.map((e) => e.method)).toEqual(["nip44_decrypt", "sign_event"]) // newest first
    expect(await log.list("B")).toHaveLength(1)
    expect(await log.list("unknown")).toEqual([])
  })

  it("persists ONLY the four whitelisted metadata fields (leak-audit invariant)", async () => {
    const storage = memoryStorage()
    const log = createActivityLog(storage)
    // A malicious/over-eager caller tacks on content — it must NOT be persisted.
    await log.record("A", {
      method: "nip44_decrypt",
      accepted: true,
      time: 5,
      // @ts-expect-error content is intentionally not part of ActivityEntry — proves it is dropped
      plaintext: "super secret message",
      peerPubkey: "npub1deadbeef",
    })
    const dumped = storage.dump() as Record<string, Record<string, unknown>[]>
    const stored = dumped.A[0]
    expect(Object.keys(stored).sort()).toEqual(["accepted", "method", "time"])
    expect(JSON.stringify(dumped)).not.toContain("super secret message")
    expect(JSON.stringify(dumped)).not.toContain("npub1deadbeef")
  })

  it("keeps eventKind only when it is a number", async () => {
    const storage = memoryStorage()
    const log = createActivityLog(storage)
    await log.record("A", { method: "sign_event", accepted: true, eventKind: 1, time: 1 })
    await log.record("A", { method: "nip44_decrypt", accepted: true, time: 2 })
    const dumped = storage.dump() as Record<string, Record<string, unknown>[]>
    expect(dumped.A[1]).toHaveProperty("eventKind", 1) // older entry, has kind
    expect(dumped.A[0]).not.toHaveProperty("eventKind") // newer entry, no kind
  })

  it("bounds the ring at ACTIVITY_RING_SIZE per client (oldest evicted)", async () => {
    const log = createActivityLog(memoryStorage())
    for (let i = 0; i < ACTIVITY_RING_SIZE + 10; i += 1) {
      await log.record("A", { method: "sign_event", accepted: true, time: i })
    }
    const a = await log.list("A")
    expect(a).toHaveLength(ACTIVITY_RING_SIZE)
    // Newest first: time should be the last recorded value.
    expect(a[0].time).toBe(ACTIVITY_RING_SIZE + 9)
    // Oldest retained is time = 10 (0..9 evicted).
    expect(a[a.length - 1].time).toBe(10)
  })

  it("aggregates accept/reject stats per client", async () => {
    const log = createActivityLog(memoryStorage())
    await log.record("A", { method: "sign_event", accepted: true, time: 1 })
    await log.record("A", { method: "sign_event", accepted: true, time: 2 })
    await log.record("A", { method: "nip44_decrypt", accepted: false, time: 3 })
    expect(await log.stats("A")).toEqual({ total: 3, accepted: 2, rejected: 1 })
    expect(await log.stats("empty")).toEqual({ total: 0, accepted: 0, rejected: 0 })
  })

  it("notifies subscribers on each record so a live screen can re-read", async () => {
    const log = createActivityLog(memoryStorage())
    const listener = jest.fn()
    const unsub = log.subscribe(listener)
    await log.record("A", { method: "connect", accepted: true, time: 1 })
    await log.record("A", { method: "get_public_key", accepted: true, time: 2 })
    expect(listener).toHaveBeenCalledTimes(2)
    unsub()
    await log.record("A", { method: "sign_event", accepted: true, time: 3 })
    expect(listener).toHaveBeenCalledTimes(2) // unsubscribed → no more calls
  })
})
