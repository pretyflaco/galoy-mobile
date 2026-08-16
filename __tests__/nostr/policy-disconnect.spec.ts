/**
 * Story 3.7 Task 4/5 — post-disconnect request policy (AC #3/#4, AD-8/AD-16).
 *
 * The tombstoned-vs-never-connected reply asymmetry is load-bearing:
 *  - a request from a TOMBSTONED (previously connected, now disconnected) pubkey →
 *    `error-disconnected` (spec error reply, so the client learns it was disconnected);
 *  - a request from a NEVER-connected pubkey → `drop-silent` (no reply, no oracle).
 *  - a later kind-22242 from a disconnected client is NOT auto-honored against the voided
 *    grant — it needs a fresh approval (re-connect consent) or is rejected.
 */
import { evaluateRequestPolicy } from "../../app/nostr/core/policy-check"
import {
  createConnectionStore,
  GRANTABLE_SCOPE,
  type ConnectionStorage,
} from "../../app/nostr/core/connection-store"

const CLIENT = "a".repeat(64)
const NEVER = "b".repeat(64)

const memory = (): ConnectionStorage => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (k) => (map.has(k) ? map.get(k) : null),
    saveJson: async (k, v) => {
      map.set(k, JSON.parse(JSON.stringify(v)))
    },
  }
}

const connect = (store: ReturnType<typeof createConnectionStore>) =>
  store.upsert({
    clientPubkey: CLIENT,
    relays: [],
    grantedScopes: [GRANTABLE_SCOPE],
    metadata: {},
    createdAt: 1,
  })

const authReq = { method: "sign_event", kind: 22242 }
const dmReq = { method: "nip44_decrypt" }

describe("post-disconnect reply asymmetry (AC #4, AD-8)", () => {
  it("a tombstoned pubkey gets error-disconnected (a spec error reply)", async () => {
    const store = createConnectionStore(memory())
    await connect(store)
    await store.disconnect(CLIENT)
    expect(await evaluateRequestPolicy(store, CLIENT, dmReq)).toBe("error-disconnected")
  })

  it("a never-connected pubkey is dropped silently (no reply)", async () => {
    const store = createConnectionStore(memory())
    expect(await evaluateRequestPolicy(store, NEVER, dmReq)).toBe("drop-silent")
  })
})

describe("later kind-22242 from a disconnected client (AC #3, AD-16)", () => {
  it("is NOT auto-honored against the voided grant — it errors as disconnected", async () => {
    const store = createConnectionStore(memory())
    await connect(store) // granted sign_event:22242
    await store.disconnect(CLIENT) // grant voided + tombstoned
    // a later auth challenge must NOT be pre-approved via the (now-void) grant
    expect(await evaluateRequestPolicy(store, CLIENT, authReq)).toBe("error-disconnected")
  })

  it("still pre-approves kind-22242 for a LIVE granted connection (regression guard)", async () => {
    const store = createConnectionStore(memory())
    await connect(store)
    expect(await evaluateRequestPolicy(store, CLIENT, authReq)).toBe("pre-approved")
  })
})
