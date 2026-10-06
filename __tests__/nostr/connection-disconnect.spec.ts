/**
 * Story 3.7 Task 3/5 — ConnectionStore.disconnect: atomic delete + grant-void + bounded
 * tombstone (AC #2/#4, AD-8/AD-17).
 *
 * disconnect(pubkey) DELETES the record AND VOIDS the grant in one atomic mutation, writing a
 * bounded tombstone. No intermediate observable state where the record is gone but the grant is
 * live. Tombstoned pubkeys are distinguishable from never-connected ones (the reply asymmetry).
 * The tombstone set is bounded (oldest evicted) — no unbounded growth.
 */
import {
  createConnectionStore,
  CONNECTIONS_STORAGE_KEY,
  GRANTABLE_SCOPE,
  TOMBSTONE_LIMIT,
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

const connect = (store: ReturnType<typeof createConnectionStore>, pubkey: string) =>
  store.upsert({
    clientPubkey: pubkey,
    relays: [],
    grantedScopes: [GRANTABLE_SCOPE],
    metadata: { name: "Damus" },
    createdAt: 1,
  })

describe("disconnect: atomic delete + void + tombstone (AC #2, AD-8)", () => {
  it("deletes the record and voids the grant atomically", async () => {
    const store = createConnectionStore(memory())
    await connect(store, CLIENT)
    await store.disconnect(CLIENT)

    expect(await store.get(CLIENT)).toBeNull() // record deleted
    expect(await store.isConnected(CLIENT)).toBe(false)
    expect(await store.hasGrant(CLIENT, GRANTABLE_SCOPE)).toBe(false) // grant voided
  })

  it("leaves a tombstone for the disconnected pubkey", async () => {
    const store = createConnectionStore(memory())
    await connect(store, CLIENT)
    await store.disconnect(CLIENT)
    expect(await store.isTombstoned(CLIENT)).toBe(true)
  })

  it("a never-connected pubkey is NOT tombstoned", async () => {
    const store = createConnectionStore(memory())
    expect(await store.isTombstoned("b".repeat(64))).toBe(false)
  })

  it("persists the mutation under nostr.connections.v1", async () => {
    const storage = memory()
    const store = createConnectionStore(storage)
    await connect(store, CLIENT)
    await store.disconnect(CLIENT)
    const persisted = JSON.stringify(storage.raw())
    expect(persisted).toContain("tombstones")
  })

  it("re-connecting a tombstoned pubkey clears its tombstone (fresh record)", async () => {
    const store = createConnectionStore(memory())
    await connect(store, CLIENT)
    await store.disconnect(CLIENT)
    expect(await store.isTombstoned(CLIENT)).toBe(true)
    await connect(store, CLIENT) // fresh approval → new record
    expect(await store.isConnected(CLIENT)).toBe(true)
    expect(await store.isTombstoned(CLIENT)).toBe(false)
  })
})

describe("bounded tombstone set (AC #2, AD-17)", () => {
  it("evicts the oldest tombstone once the bound is exceeded (no unbounded growth)", async () => {
    const store = createConnectionStore(memory())
    const pubkeys = Array.from({ length: TOMBSTONE_LIMIT + 5 }, (_u, i) =>
      i.toString(16).padStart(64, "0"),
    )
    for (const pk of pubkeys) {
      await connect(store, pk)
      await store.disconnect(pk)
    }
    // the tombstone set never exceeds the bound
    const stillTombstoned = await Promise.all(pubkeys.map((pk) => store.isTombstoned(pk)))
    expect(stillTombstoned.filter(Boolean).length).toBeLessThanOrEqual(TOMBSTONE_LIMIT)
    // the oldest (first) tombstones were evicted; the most recent survive
    expect(await store.isTombstoned(pubkeys[pubkeys.length - 1])).toBe(true)
    expect(await store.isTombstoned(pubkeys[0])).toBe(false)
  })
})
