/**
 * Story 3.3 — PolicyCheck (AC #7/#8, AD-8). Reads ONLY the ConnectionStore.
 *
 * For an inbound (non-connect) request the policy decides exactly one of:
 *  - "drop-silent"    : the client is NOT connected → no response, no npub disclosure,
 *                       no liveness oracle (AC #7).
 *  - "pre-approved"   : a kind-22242 auth-challenge sign_event on a connection that granted
 *                       sign_event:22242 → satisfied WITHOUT a second modal (AC #8, CAP-4).
 *  - "needs-approval" : a connected client whose request is not covered by the fixed grant.
 */
import { evaluateRequestPolicy } from "../../app/nostr/core/policy-check"
import {
  createConnectionStore,
  GRANTABLE_SCOPE,
  type ConnectionStorage,
} from "../../app/nostr/core/connection-store"

const CLIENT = "a".repeat(64)
const memory = (): ConnectionStorage => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (k) => (map.has(k) ? map.get(k) : null),
    saveJson: async (k, v) => {
      map.set(k, JSON.parse(JSON.stringify(v)))
    },
  }
}

const connect = async (
  store: ReturnType<typeof createConnectionStore>,
  grantedScopes: string[],
) =>
  store.upsert({
    clientPubkey: CLIENT,
    relays: [],
    grantedScopes,
    metadata: { name: "Damus" },
    createdAt: 1,
  })

// A kind-22242 auth-challenge sign_event request.
const authReq = { method: "sign_event", kind: 22242 }

describe("PolicyCheck (AC #7/#8, AD-8)", () => {
  it("drops a request from a NEVER-connected pubkey (no response)", async () => {
    const store = createConnectionStore(memory())
    const decision = await evaluateRequestPolicy(store, CLIENT, authReq)
    expect(decision).toBe("drop-silent")
  })

  it("single-approval login: granted sign_event:22242 satisfies kind-22242 WITHOUT a modal", async () => {
    const store = createConnectionStore(memory())
    await connect(store, [GRANTABLE_SCOPE])
    const decision = await evaluateRequestPolicy(store, CLIENT, authReq)
    expect(decision).toBe("pre-approved")
  })

  it("a connected client WITHOUT the grant still needs approval for kind-22242", async () => {
    const store = createConnectionStore(memory())
    await connect(store, []) // connected but no grant
    const decision = await evaluateRequestPolicy(store, CLIENT, authReq)
    expect(decision).toBe("needs-approval")
  })

  it("a non-22242 sign_event on a granted connection still needs approval (grant is 22242-only)", async () => {
    const store = createConnectionStore(memory())
    await connect(store, [GRANTABLE_SCOPE])
    const decision = await evaluateRequestPolicy(store, CLIENT, {
      method: "sign_event",
      kind: 1,
    })
    expect(decision).toBe("needs-approval")
  })

  it("an encrypt/decrypt request on a granted connection needs approval (grant does not cover it)", async () => {
    const store = createConnectionStore(memory())
    await connect(store, [GRANTABLE_SCOPE])
    const decision = await evaluateRequestPolicy(store, CLIENT, {
      method: "nip44_decrypt",
    })
    expect(decision).toBe("needs-approval")
  })
})
