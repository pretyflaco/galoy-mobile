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

/** The bounded tombstone set size (AD-17: no unbounded growth; oldest evicted). */
export const TOMBSTONE_LIMIT = 256

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
  /**
   * Records sharing a client IDENTITY (metadata.url ?? metadata.name) but a DIFFERENT pubkey.
   * A re-login mints a fresh ephemeral clientPubkey, so identity — not pubkey — is what tells
   * us "this same app is connecting again". Used to offer Replace / Keep both / Cancel instead
   * of silently accreting a duplicate row per sign-in. Empty identity never matches.
   */
  findByIdentity(identity: string, excludePubkey: string): Promise<ConnectionRecord[]>
  /** All connection records. */
  list(): Promise<ConnectionRecord[]>
  /** Whether a record exists for the clientPubkey (PolicyCheck: connected?). */
  isConnected(clientPubkey: string): Promise<boolean>
  /** Whether the client's grant includes the given scope (v1: only sign_event:22242). */
  hasGrant(clientPubkey: string, scope: string): Promise<boolean>
  /**
   * Atomically DELETE the record AND VOID the grant, leaving a bounded tombstone (AD-8).
   * There is no observable in-between state where the record is gone but the grant is live.
   */
  disconnect(clientPubkey: string): Promise<void>
  /** Whether the pubkey was previously connected and is now disconnected (tombstoned). */
  isTombstoned(clientPubkey: string): Promise<boolean>
}

type RecordMap = Record<string, ConnectionRecord>

/** Persisted shape: the connection records + the bounded, ordered tombstone list (AD-17). */
interface PersistedState {
  records: RecordMap
  /** Disconnected pubkeys, oldest-first; bounded to TOMBSTONE_LIMIT. */
  tombstones: string[]
}

const defaultStorage: ConnectionStorage = { loadJson, saveJson }

export const createConnectionStore = (
  storage: ConnectionStorage = defaultStorage,
): ConnectionStore => {
  const readState = async (): Promise<PersistedState> => {
    const raw = (await storage.loadJson(CONNECTIONS_STORAGE_KEY)) as
      | Partial<PersistedState>
      | RecordMap
      | null
    if (!raw) return { records: {}, tombstones: [] }
    // Forward-compat: a bare RecordMap from before tombstones existed is the records map.
    if ("records" in raw || "tombstones" in raw) {
      const state = raw as Partial<PersistedState>
      return { records: state.records ?? {}, tombstones: state.tombstones ?? [] }
    }
    return { records: raw as RecordMap, tombstones: [] }
  }
  const writeState = (state: PersistedState): Promise<void> =>
    storage.saveJson(CONNECTIONS_STORAGE_KEY, state)

  return {
    async upsert(record: ConnectionRecord): Promise<void> {
      const state = await readState()
      // One record per client: keying by clientPubkey means a re-upsert REPLACES.
      state.records[record.clientPubkey] = record
      // A fresh connection clears any prior tombstone for this pubkey.
      state.tombstones = state.tombstones.filter((pk) => pk !== record.clientPubkey)
      await writeState(state)
    },

    async get(clientPubkey: string): Promise<ConnectionRecord | null> {
      const state = await readState()
      return state.records[clientPubkey] ?? null
    },

    async findByIdentity(
      identity: string,
      excludePubkey: string,
    ): Promise<ConnectionRecord[]> {
      if (!identity) return [] // no stable identity → cannot dedupe; treat as distinct
      const state = await readState()
      return Object.values(state.records).filter(
        (r) =>
          r.clientPubkey !== excludePubkey &&
          (r.metadata.url ?? r.metadata.name) === identity,
      )
    },

    async list(): Promise<ConnectionRecord[]> {
      return Object.values((await readState()).records)
    },

    async isConnected(clientPubkey: string): Promise<boolean> {
      const state = await readState()
      return Boolean(state.records[clientPubkey])
    },

    async hasGrant(clientPubkey: string, scope: string): Promise<boolean> {
      const state = await readState()
      return Boolean(state.records[clientPubkey]?.grantedScopes.includes(scope))
    },

    async disconnect(clientPubkey: string): Promise<void> {
      const state = await readState()
      // Atomic: delete the record (which carries the grant) and add the tombstone in ONE
      // write — there is no persisted state where the record is gone but the grant is live.
      delete state.records[clientPubkey]
      const tombstones = state.tombstones.filter((pk) => pk !== clientPubkey)
      tombstones.push(clientPubkey)
      // Bounded: evict oldest so the tombstone set never grows without limit.
      state.tombstones = tombstones.slice(-TOMBSTONE_LIMIT)
      await writeState(state)
    },

    async isTombstoned(clientPubkey: string): Promise<boolean> {
      const state = await readState()
      return state.tombstones.includes(clientPubkey)
    },
  }
}
