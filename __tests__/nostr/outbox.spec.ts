/**
 * Story 2.1 — persistent single-slot npub outbox (AD-12 / AD-17).
 *
 * The outbox is a single-slot latest-state cell `{npub, seq}` with a monotonic sequence,
 * persisted under `nostr.outbox.v1` via an injected storage port. A superseded npub can
 * never win a race; a pending/failing push never blocks the identity.
 */
import {
  createPersistentNpubOutbox,
  OUTBOX_STORAGE_KEY,
  type OutboxStorage,
} from "../../app/nostr/core/outbox"

/** In-memory storage double mirroring app/utils/storage {loadJson, saveJson}. */
const makeMemStorage = (): OutboxStorage & { map: Map<string, unknown> } => {
  const map = new Map<string, unknown>()
  return {
    map,
    loadJson: async (key: string) => (map.has(key) ? map.get(key) : null),
    saveJson: async (key: string, value: unknown) => {
      // Round-trip through JSON so tests see exactly what AsyncStorage would persist.
      map.set(key, JSON.parse(JSON.stringify(value)))
    },
  }
}

describe("persistent single-slot npub outbox (AD-12)", () => {
  it("starts empty", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    expect(await outbox.pending()).toBeNull()
  })

  it("enqueue holds {npub, seq} and a newer enqueue supersedes the pending one", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    await outbox.enqueue("npub_a")
    const first = await outbox.pending()
    expect(first?.npub).toBe("npub_a")

    await outbox.enqueue("npub_b") // supersedes
    const second = await outbox.pending()
    expect(second?.npub).toBe("npub_b")
    // Monotonic: the superseding entry carries a strictly higher seq.
    expect(second?.seq).toBeGreaterThan(first?.seq as number)
  })

  it("seq is strictly monotonic increasing across enqueues", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    await outbox.enqueue("npub_a")
    const a = (await outbox.pending())?.seq as number
    await outbox.enqueue("npub_b")
    const b = (await outbox.pending())?.seq as number
    await outbox.enqueue("npub_c")
    const c = (await outbox.pending())?.seq as number
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })

  it("markDrained clears ONLY if the drained seq is still the current pending seq", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    await outbox.enqueue("npub_a")
    const staleSeq = (await outbox.pending())?.seq as number
    await outbox.enqueue("npub_b") // supersedes; current seq is now higher

    // A stale drain (old seq) must NOT clobber the newer pending entry.
    await outbox.markDrained(staleSeq)
    expect((await outbox.pending())?.npub).toBe("npub_b")

    // Draining the current seq clears the slot.
    const currentSeq = (await outbox.pending())?.seq as number
    await outbox.markDrained(currentSeq)
    expect(await outbox.pending()).toBeNull()
  })
})

describe("persistence + restart survival (AD-17)", () => {
  it("persists {npub, seq} under nostr.outbox.v1", async () => {
    const storage = makeMemStorage()
    const outbox = createPersistentNpubOutbox(storage)
    await outbox.enqueue("npub_a")
    const persisted = storage.map.get(OUTBOX_STORAGE_KEY) as {
      npub: string
      seq: number
    }
    expect(persisted.npub).toBe("npub_a")
    expect(typeof persisted.seq).toBe("number")
  })

  it("a fresh instance over the same storage reads the prior slot (restart survival)", async () => {
    const storage = makeMemStorage()
    const first = createPersistentNpubOutbox(storage)
    await first.enqueue("npub_a")
    const priorSeq = (await first.pending())?.seq as number

    // Simulate a restart: new instance, same underlying storage.
    const revived = createPersistentNpubOutbox(storage)
    const pending = await revived.pending()
    expect(pending?.npub).toBe("npub_a")
    expect(pending?.seq).toBe(priorSeq)
  })

  it("seq continues monotonically after a restart (never resets to 0)", async () => {
    const storage = makeMemStorage()
    const first = createPersistentNpubOutbox(storage)
    await first.enqueue("npub_a")
    await first.enqueue("npub_b")
    const beforeRestart = (await first.pending())?.seq as number

    const revived = createPersistentNpubOutbox(storage)
    await revived.enqueue("npub_c")
    const afterRestart = (await revived.pending())?.seq as number
    expect(afterRestart).toBeGreaterThan(beforeRestart)
  })

  it("markDrained persists the cleared slot; a fresh instance sees it drained", async () => {
    const storage = makeMemStorage()
    const first = createPersistentNpubOutbox(storage)
    await first.enqueue("npub_a")
    const seq = (await first.pending())?.seq as number
    await first.markDrained(seq)

    const revived = createPersistentNpubOutbox(storage)
    expect(await revived.pending()).toBeNull()
  })
})

describe("non-blocking invariant (FR-9 / AD-12)", () => {
  it("enqueue does not throw when the underlying saveJson rejects", async () => {
    const storage: OutboxStorage = {
      loadJson: async () => null,
      saveJson: async () => {
        throw new Error("disk full")
      },
    }
    const outbox = createPersistentNpubOutbox(storage)
    // Must resolve (swallow), never reject — a failed push cannot block the identity.
    await expect(outbox.enqueue("npub_a")).resolves.toBeUndefined()
    // The in-memory slot stays authoritative so the identity is usable regardless.
    expect((await outbox.pending())?.npub).toBe("npub_a")
  })
})
