/**
 * Story 3.2 — persisted request ledger (AC #3, AD-16/AD-17).
 *
 * Keyed (clientPubkey, requestId) under nostr.requests.v1. Each request is surfaced AT MOST
 * once and answered EXACTLY once. Redelivery of an ANSWERED request re-sends the stored
 * response (never re-executes); redelivery of a PENDING request never re-enqueues. Answered
 * entries carry the stored response so re-send needs no re-execution.
 *
 * Framework-agnostic (core, AD-1): an in-memory storage port is injected so the ledger is
 * unit-testable without AsyncStorage; the default binds to app/utils/storage.
 */
import {
  createRequestLedger,
  REQUESTS_STORAGE_KEY,
  type LedgerStorage,
} from "../../app/nostr/core/request-ledger"

const makeMemoryStorage = (): LedgerStorage & { dump: () => unknown } => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (key: string) => (map.has(key) ? map.get(key) : null),
    saveJson: async (key: string, value: unknown) => {
      map.set(key, JSON.parse(JSON.stringify(value)))
    },
    dump: () => map.get(REQUESTS_STORAGE_KEY),
  }
}

const CLIENT = "a".repeat(64)

describe("request ledger at-most-once / exactly-once (AC #3)", () => {
  it("a fresh request enqueues exactly once (first sighting is pending)", async () => {
    const storage = makeMemoryStorage()
    const ledger = createRequestLedger(storage)

    const first = await ledger.register(CLIENT, "req-1")
    expect(first).toMatchObject({ status: "new" })

    // stored as pending under the versioned key
    const persisted = await ledger.lookup(CLIENT, "req-1")
    expect(persisted?.state).toBe("pending")
  })

  it("redelivery while PENDING does not re-enqueue / re-surface", async () => {
    const storage = makeMemoryStorage()
    const ledger = createRequestLedger(storage)
    await ledger.register(CLIENT, "req-1")

    const again = await ledger.register(CLIENT, "req-1")
    expect(again.status).toBe("pending-duplicate") // not "new" → never re-surfaced
  })

  it("redelivery after ANSWERED re-sends the stored response (no re-execution)", async () => {
    const storage = makeMemoryStorage()
    const ledger = createRequestLedger(storage)
    await ledger.register(CLIENT, "req-1")
    await ledger.recordResponse(CLIENT, "req-1", "STORED-RESPONSE")

    const again = await ledger.register(CLIENT, "req-1")
    expect(again).toMatchObject({
      status: "answered",
      storedResponse: "STORED-RESPONSE",
    })
  })

  it("answers exactly once: a second recordResponse does not overwrite the first", async () => {
    const storage = makeMemoryStorage()
    const ledger = createRequestLedger(storage)
    await ledger.register(CLIENT, "req-1")
    await ledger.recordResponse(CLIENT, "req-1", "FIRST")
    await ledger.recordResponse(CLIENT, "req-1", "SECOND")

    const entry = await ledger.lookup(CLIENT, "req-1")
    expect(entry).toMatchObject({ state: "answered", response: "FIRST" })
  })

  it("keys by (clientPubkey, requestId): same id from different clients are distinct", async () => {
    const storage = makeMemoryStorage()
    const ledger = createRequestLedger(storage)
    const other = "b".repeat(64)
    await ledger.register(CLIENT, "req-1")
    const otherFirst = await ledger.register(other, "req-1")
    expect(otherFirst.status).toBe("new") // different client → a distinct entry
  })

  it("persists under nostr.requests.v1", async () => {
    const storage = makeMemoryStorage()
    const ledger = createRequestLedger(storage)
    await ledger.register(CLIENT, "req-1")
    expect(storage.dump()).toBeTruthy() // written under REQUESTS_STORAGE_KEY
    expect(REQUESTS_STORAGE_KEY).toBe("nostr.requests.v1")
  })
})
