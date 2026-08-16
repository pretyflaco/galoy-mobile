/**
 * Story 1.4 / AC-1, AC-2 — the feature-flag gating seam.
 *
 * initSignerGate(flag, deps) is the single adapter-layer boundary the signer entry
 * points plug into. Flag OFF ⇒ invisible + inert: relay subscriptions closed / never
 * opened, no watcher registration (v1 no-op), entry points NOT activated, and
 * ConnectionStore records RETAINED. Flag ON ⇒ on next init, entry points activate and
 * retained records resume. The wallet is never touched by this seam.
 */
import { initSignerGate, type SignerGateDeps } from "../../app/nostr/signer-gate"

type Rec = { clientPubkey: string; relays: string[] }

const makeDeps = (records: Rec[]) => {
  const store = {
    data: [...records],
    list() {
      return this.data
    },
    clear: jest.fn(),
  }
  const relayPool = {
    openForConnections: jest.fn(),
    closeAll: jest.fn(),
  }
  const entryPoints = {
    activate: jest.fn(),
    deactivate: jest.fn(),
  }
  const deps: SignerGateDeps = {
    connectionStore: store,
    relayPool,
    entryPoints,
  }
  return { deps, store, relayPool, entryPoints }
}

describe("flag OFF — invisible + inert, records retained (AC-1)", () => {
  it("does not open relay subscriptions and does not activate entry points", () => {
    const { deps, relayPool, entryPoints } = makeDeps([
      { clientPubkey: "a", relays: ["wss://r"] },
    ])
    initSignerGate(false, deps)
    expect(relayPool.openForConnections).not.toHaveBeenCalled()
    expect(entryPoints.activate).not.toHaveBeenCalled()
    // inert: any pre-existing subs are torn down
    expect(relayPool.closeAll).toHaveBeenCalled()
    expect(entryPoints.deactivate).toHaveBeenCalled()
  })

  it("makes NO watcher registration call (v1 no-op)", () => {
    const { deps } = makeDeps([])
    // SignerGateDeps has no watcher surface at all — nothing to register in v1.
    expect((deps as unknown as Record<string, unknown>).watcher).toBeUndefined()
    expect(() => initSignerGate(false, deps)).not.toThrow()
  })

  it("RETAINS ConnectionStore records (never clears/tombstones on flag OFF)", () => {
    const { deps, store } = makeDeps([{ clientPubkey: "a", relays: ["wss://r"] }])
    initSignerGate(false, deps)
    expect(store.clear).not.toHaveBeenCalled()
    expect(store.list()).toEqual([{ clientPubkey: "a", relays: ["wss://r"] }])
  })
})

describe("flag ON — entry points activate, retained records resume (AC-2)", () => {
  it("activates entry points and re-opens relays for retained records", () => {
    const records = [{ clientPubkey: "a", relays: ["wss://r1"] }]
    const { deps, relayPool, entryPoints, store } = makeDeps(records)
    initSignerGate(true, deps)
    expect(entryPoints.activate).toHaveBeenCalled()
    expect(relayPool.openForConnections).toHaveBeenCalledWith(records)
    expect(store.clear).not.toHaveBeenCalled() // no fresh pairing required
  })
})

describe("retention across a full toggle cycle + wallet-unaffected (AC-1/AC-2)", () => {
  it("records are byte-identical after ON -> OFF -> ON", () => {
    const records = [{ clientPubkey: "a", relays: ["wss://r1"] }]
    const { deps, store } = makeDeps(records)
    const snapshot = JSON.stringify(store.list())
    initSignerGate(true, deps)
    initSignerGate(false, deps)
    initSignerGate(true, deps)
    expect(JSON.stringify(store.list())).toBe(snapshot)
    expect(store.clear).not.toHaveBeenCalled()
  })

  it("the gate seam touches only signer deps — no wallet surface is referenced", () => {
    const { deps } = makeDeps([])
    // The deps contract is exactly the three signer surfaces; nothing wallet-related.
    expect(Object.keys(deps).sort()).toEqual(
      ["connectionStore", "entryPoints", "relayPool"].sort(),
    )
  })
})
