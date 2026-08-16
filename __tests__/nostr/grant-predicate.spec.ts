/**
 * Story 3.4 Task 2 — the "is this covered by the connect-time grant?" predicate is centralized
 * (PolicyCheck) and SHARED between the pipeline and the coordinator. The coordinator adapter
 * `grantCoverageFromPolicy` derives `isCoveredByGrant` from `evaluateRequestPolicy` so there is
 * ONE definition of the fixed grant (sign_event:22242 on a granting connection).
 */
import { grantCoverageFromPolicy } from "../../app/nostr/approval/grant-adapter"
import {
  createConnectionStore,
  GRANTABLE_SCOPE,
  type ConnectionStorage,
} from "../../app/nostr/core/connection-store"
import type { RequestApprovalEntry } from "../../app/nostr/approval/coordinator"

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

const requestEntry = (
  over: Partial<RequestApprovalEntry> = {},
): RequestApprovalEntry => ({
  id: "r1",
  kind: "request",
  clientPubkey: CLIENT,
  method: "sign_event",
  eventKind: 22242,
  humanAction: "sign in",
  ...over,
})

const connect = async (
  store: ReturnType<typeof createConnectionStore>,
  grantedScopes: string[],
) =>
  store.upsert({
    clientPubkey: CLIENT,
    relays: [],
    grantedScopes,
    metadata: {},
    createdAt: 1,
  })

describe("shared grant predicate (Task 2, AD-9)", () => {
  it("covers a kind-22242 sign_event on a granting connection (single-approval login)", async () => {
    const store = createConnectionStore(memory())
    await connect(store, [GRANTABLE_SCOPE])
    const isCovered = grantCoverageFromPolicy(store)
    expect(await isCovered(requestEntry())).toBe(true)
  })

  it("does NOT cover it when the connection did not grant sign_event:22242", async () => {
    const store = createConnectionStore(memory())
    await connect(store, [])
    const isCovered = grantCoverageFromPolicy(store)
    expect(await isCovered(requestEntry())).toBe(false)
  })

  it("does NOT cover a non-22242 sign_event (grant is 22242-only)", async () => {
    const store = createConnectionStore(memory())
    await connect(store, [GRANTABLE_SCOPE])
    const isCovered = grantCoverageFromPolicy(store)
    expect(await isCovered(requestEntry({ eventKind: 1 }))).toBe(false)
  })

  it("never covers a connection-approval entry (connections always raise a surface)", async () => {
    const store = createConnectionStore(memory())
    await connect(store, [GRANTABLE_SCOPE])
    const isCovered = grantCoverageFromPolicy(store)
    expect(
      await isCovered({
        id: "c1",
        kind: "connection",
        clientPubkey: CLIENT,
        metadata: {},
      }),
    ).toBe(false)
  })
})
