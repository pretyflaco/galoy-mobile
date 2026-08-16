/**
 * ConnectionStore (Story 3.3 / AD-8 / AD-17) — the SOLE owner of connection + grant state.
 *
 * Keyed by `clientPubkey`, EXACTLY ONE record per client. Persisted as JSON under
 * `nostr.connections.v1` (AD-17), NOT the keystore. `PolicyCheck` reads ONLY this store —
 * there is no "remember this app", no configurable policy, no second source of grant truth.
 *
 * The v1 grantable set is EXACTLY `sign_event:22242`: `grantedScopes` contains that scope or
 * is empty — nothing else. The connect `secret` is transient handshake state and is NEVER
 * persisted here.
 *
 * AD-1: core is UI-free. The storage port is injected (unit-testable); the default binds to
 * `app/utils/storage`. Story 3.7 adds `disconnect` (atomic delete + void + bounded tombstone).
 */
import { loadJson, saveJson } from "@app/utils/storage"

/** AD-17 storage key. */
export const CONNECTIONS_STORAGE_KEY = "nostr.connections.v1"

/** The ONLY grantable scope in v1 (AD-8). */
export const GRANTABLE_SCOPE = "sign_event:22242"

/** Client identity/metadata carried from the nostrconnect:// URI. */
export interface ClientMetadata {
  name?: string
  url?: string
  image?: string
}

/** One connection record per client (AD-8). The secret is NEVER stored here. */
export interface ConnectionRecord {
  clientPubkey: string
  relays: string[]
  /** Exactly ['sign_event:22242'] or [] — nothing else. */
  grantedScopes: string[]
  metadata: ClientMetadata
  createdAt: number
}

/** The narrow persistence port (injected; defaults to app/utils/storage). */
export interface ConnectionStorage {
  loadJson: (key: string) => Promise<unknown>
  saveJson: (key: string, value: unknown) => Promise<void>
}

export interface ConnectionStore {
  /** Insert or REPLACE the single record for a clientPubkey. */
  upsert(record: ConnectionRecord): Promise<void>
  /** The record for a clientPubkey, or null. */
  get(clientPubkey: string): Promise<ConnectionRecord | null>
  /** All connection records. */
  list(): Promise<ConnectionRecord[]>
  /** Whether a record exists for the clientPubkey (PolicyCheck: connected?). */
  isConnected(clientPubkey: string): Promise<boolean>
  /** Whether the client's grant includes the given scope (v1: only sign_event:22242). */
  hasGrant(clientPubkey: string, scope: string): Promise<boolean>
}

type RecordMap = Record<string, ConnectionRecord>

const defaultStorage: ConnectionStorage = { loadJson, saveJson }

export const createConnectionStore = (
  storage: ConnectionStorage = defaultStorage,
): ConnectionStore => {
  const readAll = async (): Promise<RecordMap> => {
    const raw = (await storage.loadJson(CONNECTIONS_STORAGE_KEY)) as RecordMap | null
    return raw ?? {}
  }
  const writeAll = (map: RecordMap): Promise<void> =>
    storage.saveJson(CONNECTIONS_STORAGE_KEY, map)

  return {
    async upsert(record: ConnectionRecord): Promise<void> {
      const map = await readAll()
      // One record per client: keying by clientPubkey means a re-upsert REPLACES.
      map[record.clientPubkey] = record
      await writeAll(map)
    },

    async get(clientPubkey: string): Promise<ConnectionRecord | null> {
      const map = await readAll()
      return map[clientPubkey] ?? null
    },

    async list(): Promise<ConnectionRecord[]> {
      return Object.values(await readAll())
    },

    async isConnected(clientPubkey: string): Promise<boolean> {
      const map = await readAll()
      return Boolean(map[clientPubkey])
    },

    async hasGrant(clientPubkey: string, scope: string): Promise<boolean> {
      const map = await readAll()
      return Boolean(map[clientPubkey]?.grantedScopes.includes(scope))
    },
  }
}
