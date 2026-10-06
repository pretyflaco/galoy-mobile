/**
 * Story 3.3 — ConnectionStore: sole owner of connection/grant state (AC #4/#5, AD-8/AD-17).
 *
 * Keyed by clientPubkey, EXACTLY ONE record per client
 * `{clientPubkey, relays, grantedScopes, metadata, createdAt}`, persisted as JSON under
 * `nostr.connections.v1`. The v1 grantable set is EXACTLY `sign_event:22242` (or empty).
 * A second write for the same clientPubkey replaces — never a second record.
 *
 * Framework-agnostic (core, AD-1): an in-memory storage port is injected.
 */
import {
  createConnectionStore,
  CONNECTIONS_STORAGE_KEY,
  GRANTABLE_SCOPE,
  type ConnectionStorage,
} from "../../app/nostr/core/connection-store"

const memory = (): ConnectionStorage & { raw: () => unknown } => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (k) => (map.has(k) ? map.get(k) : null),
    saveJson: async (k, v) => {
      map.set(k, JSON.parse(JSON.stringify(v)))
    },
    raw: () => map.get(CONNECTIONS_STORAGE_KEY),
  }
}

const CLIENT = "a".repeat(64)
const OTHER = "b".repeat(64)

const record = (clientPubkey: string, grantedScopes: string[] = [GRANTABLE_SCOPE]) => ({
  clientPubkey,
  relays: ["wss://relay.example"],
  grantedScopes,
  metadata: { name: "Damus" },
  createdAt: 1_700_000_000,
})

describe("ConnectionStore one-record-per-client (AC #4)", () => {
  it("upserts a record and reads it back by clientPubkey", async () => {
    const store = createConnectionStore(memory())
    await store.upsert(record(CLIENT))
    const got = await store.get(CLIENT)
    expect(got).toMatchObject({ clientPubkey: CLIENT, grantedScopes: [GRANTABLE_SCOPE] })
  })

  it("a second upsert for the same clientPubkey REPLACES (never a second record)", async () => {
    const store = createConnectionStore(memory())
    await store.upsert(record(CLIENT))
    await store.upsert({ ...record(CLIENT), relays: ["wss://new.relay"] })
    const all = await store.list()
    expect(all.filter((r) => r.clientPubkey === CLIENT)).toHaveLength(1)
    expect((await store.get(CLIENT))?.relays).toEqual(["wss://new.relay"])
  })

  it("keeps distinct records for distinct clients", async () => {
    const store = createConnectionStore(memory())
    await store.upsert(record(CLIENT))
    await store.upsert(record(OTHER))
    expect(await store.list()).toHaveLength(2)
  })

  it("persists under nostr.connections.v1 (AD-17)", async () => {
    const storage = memory()
    const store = createConnectionStore(storage)
    await store.upsert(record(CLIENT))
    expect(CONNECTIONS_STORAGE_KEY).toBe("nostr.connections.v1")
    expect(storage.raw()).toBeTruthy()
  })

  it("get() returns null for an unknown client", async () => {
    const store = createConnectionStore(memory())
    expect(await store.get(CLIENT)).toBeNull()
  })
})

describe("findByIdentity (re-login dedupe, fix #4)", () => {
  it("finds same-identity records under a DIFFERENT pubkey", async () => {
    const store = createConnectionStore(memory())
    await store.upsert(record(CLIENT)) // metadata.name = "Damus"
    await store.upsert(record(OTHER)) // also "Damus"
    const dups = await store.findByIdentity("Damus", OTHER)
    expect(dups.map((r) => r.clientPubkey)).toEqual([CLIENT]) // excludes OTHER itself
  })

  it("prefers metadata.url over name as the identity key", async () => {
    const store = createConnectionStore(memory())
    await store.upsert({
      ...record(CLIENT),
      metadata: { name: "Damus", url: "https://damus.io" },
    })
    expect(await store.findByIdentity("https://damus.io", OTHER)).toHaveLength(1)
    // The name no longer matches once a url is present (url is the identity).
    expect(await store.findByIdentity("Damus", OTHER)).toHaveLength(0)
  })

  it("returns empty for an empty identity (no stable key → never dedupe)", async () => {
    const store = createConnectionStore(memory())
    await store.upsert({ ...record(CLIENT), metadata: {} })
    expect(await store.findByIdentity("", OTHER)).toEqual([])
  })
})

describe("grant/policy reads (AC #5, AD-8)", () => {
  it("hasGrant is true only when grantedScopes includes sign_event:22242", async () => {
    const store = createConnectionStore(memory())
    await store.upsert(record(CLIENT, [GRANTABLE_SCOPE]))
    await store.upsert(record(OTHER, []))
    expect(await store.hasGrant(CLIENT, GRANTABLE_SCOPE)).toBe(true)
    expect(await store.hasGrant(OTHER, GRANTABLE_SCOPE)).toBe(false)
  })

  it("isConnected reflects presence of a record (PolicyCheck reads only ConnectionStore)", async () => {
    const store = createConnectionStore(memory())
    await store.upsert(record(CLIENT))
    expect(await store.isConnected(CLIENT)).toBe(true)
    expect(await store.isConnected(OTHER)).toBe(false)
  })

  it("the grantable scope constant is exactly sign_event:22242", () => {
    expect(GRANTABLE_SCOPE).toBe("sign_event:22242")
  })
})
