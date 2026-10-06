/**
 * B5 — scoped local registry of created grants: public material only, per-account scoping,
 * inert on a null account key (never a shared slot).
 */
import type { GrantRecord } from "@app/self-custodial/grants/grant-api"

// In-memory stand-in for the AsyncStorage-backed helpers (loadJson/saveJson/remove).
const backing: Record<string, string> = {}
jest.mock("@app/utils/storage", () => ({
  loadJson: async (key: string): Promise<unknown> =>
    key in backing ? JSON.parse(backing[key]) : null,
  saveJson: async (key: string, value: unknown): Promise<void> => {
    backing[key] = JSON.stringify(value)
  },
  remove: async (key: string): Promise<void> => {
    delete backing[key]
  },
}))

import {
  loadGrants,
  removeGrant,
  saveGrant,
} from "@app/self-custodial/grants/grant-store"

const record = (pubkey: string): GrantRecord => ({
  delegatedPubkey: pubkey,
  ownerPubkey: "aa".repeat(33),
  lightningAddress: "me@lnurl.twentyone.ist",
  expiresAtSecs: 2000000000,
})

describe("grant-store", () => {
  beforeEach(() => {
    for (const key of Object.keys(backing)) delete backing[key]
  })

  it("saves, loads, and dedupes by delegated pubkey", async () => {
    await saveGrant("acct-1", record("bb".repeat(33)))
    await saveGrant("acct-1", record("cc".repeat(33)))
    await saveGrant("acct-1", record("bb".repeat(33))) // rotation/upsert
    const grants = await loadGrants("acct-1")
    expect(grants.map((g) => g.delegatedPubkey)).toEqual([
      "bb".repeat(33),
      "cc".repeat(33),
    ])
  })

  it("scopes storage per account", async () => {
    await saveGrant("acct-1", record("bb".repeat(33)))
    expect(await loadGrants("acct-2")).toEqual([])
  })

  it("is inert for a null account key (no writes, no reads)", async () => {
    await saveGrant(null, record("bb".repeat(33)))
    expect(Object.keys(backing)).toEqual([])
    expect(await loadGrants(null)).toEqual([])
  })

  it("removes a revoked grant and clears the key when empty", async () => {
    await saveGrant("acct-1", record("bb".repeat(33)))
    await removeGrant("acct-1", "dd".repeat(33))
    expect((await loadGrants("acct-1")).map((g) => g.delegatedPubkey)).toEqual([
      "bb".repeat(33),
    ])
    await removeGrant("acct-1", "bb".repeat(33))
    expect(await loadGrants("acct-1")).toEqual([])
  })
})
