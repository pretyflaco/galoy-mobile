/**
 * Persisted request ledger (Story 3.2 / AD-16 / AD-17).
 *
 * Keyed (clientPubkey, requestId) under `nostr.requests.v1`. Enforces the request lifecycle:
 * a request is surfaced AT MOST once and answered EXACTLY once.
 *
 *  - First sighting  → `new`  (caller may surface/execute it; entry stored as `pending`).
 *  - Redelivery while pending → `pending-duplicate` (never re-surfaced, never re-enqueued).
 *  - Redelivery after answered → `answered` + the STORED response (re-send WITHOUT
 *    re-execution — answered entries carry the response so the reply is replayable).
 *
 * `recordResponse` is write-once: a second call for an already-answered entry is ignored, so
 * a request is answered exactly once even under a redelivery race.
 *
 * AD-1: core is UI-free. AD-17: persists as JSON via `app/utils/storage` (AsyncStorage). The
 * storage port is injected so the ledger is unit-testable; the default binds to that util.
 */
import { loadJson, saveJson } from "@app/utils/storage"

/** AD-17 storage key. */
export const REQUESTS_STORAGE_KEY = "nostr.requests.v1"

/** The narrow persistence port (injected; defaults to app/utils/storage). */
export interface LedgerStorage {
  loadJson: (key: string) => Promise<unknown>
  saveJson: (key: string, value: unknown) => Promise<void>
}

type EntryState = "pending" | "answered"

export interface LedgerEntry {
  state: EntryState
  /** The stored response for an answered entry (replayable without re-execution). */
  response?: string
}

/** Result of registering (sighting) a request. */
export type RegisterResult =
  | { status: "new" }
  | { status: "pending-duplicate" }
  | { status: "answered"; storedResponse: string | undefined }

export interface RequestLedger {
  /** Sight a request; returns whether it is new, a pending duplicate, or already answered. */
  register(clientPubkey: string, requestId: string): Promise<RegisterResult>
  /** Store the response for a pending entry (write-once → answered). */
  recordResponse(clientPubkey: string, requestId: string, response: string): Promise<void>
  /** Read the raw entry (or null). */
  lookup(clientPubkey: string, requestId: string): Promise<LedgerEntry | null>
}

type LedgerMap = Record<string, LedgerEntry>

const compositeKey = (clientPubkey: string, requestId: string): string =>
  `${clientPubkey}:${requestId}`

const defaultStorage: LedgerStorage = { loadJson, saveJson }

export const createRequestLedger = (
  storage: LedgerStorage = defaultStorage,
): RequestLedger => {
  const readAll = async (): Promise<LedgerMap> => {
    const raw = (await storage.loadJson(REQUESTS_STORAGE_KEY)) as LedgerMap | null
    return raw ?? {}
  }
  const writeAll = (map: LedgerMap): Promise<void> =>
    storage.saveJson(REQUESTS_STORAGE_KEY, map)

  return {
    async register(clientPubkey, requestId): Promise<RegisterResult> {
      const map = await readAll()
      const key = compositeKey(clientPubkey, requestId)
      const existing = map[key]

      if (!existing) {
        map[key] = { state: "pending" }
        await writeAll(map)
        return { status: "new" }
      }
      if (existing.state === "answered") {
        return { status: "answered", storedResponse: existing.response }
      }
      return { status: "pending-duplicate" }
    },

    async recordResponse(clientPubkey, requestId, response): Promise<void> {
      const map = await readAll()
      const key = compositeKey(clientPubkey, requestId)
      const existing = map[key]
      // Write-once: never overwrite an already-answered entry (answered exactly once).
      if (existing?.state === "answered") return
      map[key] = { state: "answered", response }
      await writeAll(map)
    },

    async lookup(clientPubkey, requestId): Promise<LedgerEntry | null> {
      const map = await readAll()
      return map[compositeKey(clientPubkey, requestId)] ?? null
    },
  }
}
