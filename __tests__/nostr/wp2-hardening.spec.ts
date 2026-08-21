/**
 * WP2 hardening regression suite (audit H2 / F1 / F2).
 *
 * Covers the fixes that land together because they share files:
 *  - H2: PolicyCheck drop-silent / error-disconnected enforced at the dispatch stage
 *    (never-connected traffic gets NO reply/surface/activity; tombstoned clients get the
 *    spec error reply without any execution);
 *  - F1: request-ledger register/recordResponse serialized through a promise-chain mutex
 *    (concurrent sightings of one request cannot both win);
 *  - F2a: a throwing post-admit handler resolves the ledger entry with a spec error instead
 *    of stranding it pending forever;
 *  - F2b: a PRESENTED approval auto-rejects after the timeout (the FIFO head can never be
 *    pinned indefinitely);
 *  - bounds: decoded field length caps (nip46-codec) and ledger eviction.
 */
import * as nip44 from "nostr-tools/nip44"
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure"
import { hexToBytes } from "@noble/hashes/utils.js"

import { createSignerRuntime, type SignerRuntimeDeps } from "../../app/nostr/runtime"
import { NIP46_KIND, decodeRequest } from "../../app/nostr/transport/nip46-codec"
import { __resetRelayPoolForTest } from "../../app/nostr/transport/relay-pool"
import {
  __resetApprovalCoordinatorForTest,
  createApprovalCoordinator,
  type ApprovalEntry,
} from "../../app/nostr/approval/coordinator"
import {
  REQUESTS_MAX_ENTRIES,
  REQUESTS_STORAGE_KEY,
  createRequestLedger,
} from "../../app/nostr/core/request-ledger"

const clientSk = generateSecretKey()
const clientPubkey = getPublicKey(clientSk)

const makeMemoryStorage = () => {
  const map = new Map<string, unknown>()
  return {
    map,
    loadJson: async (k: string) => map.get(k) ?? null,
    saveJson: async (k: string, v: unknown) => {
      map.set(k, v)
    },
  }
}

const readNsecHex = async () => Buffer.from(generateSecretKey()).toString("hex")

const makeDeps = (over: Partial<SignerRuntimeDeps> = {}): SignerRuntimeDeps => ({
  readNsecHex,
  // M2 fix: transport reader is REQUIRED (distinct key per runtime).
  readTransportSkHex: async () => Buffer.from(generateSecretKey()).toString("hex"),
  storage: makeMemoryStorage(),
  createPool: () => ({
    subscribe: () => ({ close: () => undefined }),
    publish: () => [Promise.resolve("ok")],
    ensureRelay: () => Promise.resolve({}),
    close: () => undefined,
    destroy: () => undefined,
  }),
  log: () => undefined,
  ...over,
})

const asWireEvent = (event: unknown) => JSON.parse(JSON.stringify(event))

const makeInbound = (ciphertext: string) =>
  asWireEvent(
    finalizeEvent(
      {
        kind: NIP46_KIND,
        // eslint-disable-next-line camelcase
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: ciphertext,
      },
      clientSk,
    ),
  )

const flushAsync = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

beforeEach(() => {
  __resetRelayPoolForTest()
  __resetApprovalCoordinatorForTest()
})

describe("H2: connection-state gate at the dispatch stage", () => {
  const decodeForSignEvent = () => ({
    scheme: "nip44" as const,
    clientPubkey,
    request: {
      id: "gate-1",
      method: "sign_event",
      params: [JSON.stringify({ kind: 22242, content: "", tags: [] })],
    },
  })

  it("drops a NEVER-connected client silently: no surface, no activity, nothing recorded", async () => {
    const present = jest.fn(async () => undefined)
    const runtime = createSignerRuntime(
      makeDeps({ present, decodeForTest: decodeForSignEvent }),
    )
    await runtime.handleInbound(makeInbound("verified") as never)
    await flushAsync()

    expect(present).not.toHaveBeenCalled()
    expect(await runtime.listActivity(clientPubkey)).toEqual([])
  })

  it("answers a TOMBSTONED client with a disconnect error — no surface, no execution", async () => {
    const present = jest.fn(async () => undefined)
    const storage = makeMemoryStorage()
    const runtime = createSignerRuntime(
      makeDeps({ present, storage, decodeForTest: decodeForSignEvent }),
    )
    // Connect, then disconnect → the pubkey becomes a bounded tombstone.
    await runtime.grantForTest(clientPubkey, ["sign_event:22242"])
    await runtime.disconnect(clientPubkey)

    await runtime.handleInbound(makeInbound("verified") as never)
    await flushAsync()

    // No surface may rise against a voided grant; the rejection IS recorded as activity.
    expect(present).not.toHaveBeenCalled()
    const activity = await runtime.listActivity(clientPubkey)
    expect(activity.some((e) => e.method === "sign_event" && !e.accepted)).toBe(true)
  })

  it("a tombstoned client's request writes NOTHING to the request ledger (no eviction lever)", async () => {
    // The tombstone reply is idempotent and the entry was never register()ed — recording it
    // would let an ex-client mint unbounded unique-id entries that FIFO-evict live clients'
    // dedupe entries (replay-protection flush). The ledger must stay untouched; a redelivery
    // simply re-sends the same error.
    const present = jest.fn(async () => undefined)
    const storage = makeMemoryStorage()
    const runtime = createSignerRuntime(
      makeDeps({ present, storage, decodeForTest: decodeForSignEvent }),
    )
    await runtime.grantForTest(clientPubkey, ["sign_event:22242"])
    await runtime.disconnect(clientPubkey)

    await runtime.handleInbound(makeInbound("verified") as never)
    await runtime.handleInbound(makeInbound("verified") as never) // redelivery
    await flushAsync()

    expect(present).not.toHaveBeenCalled()
    // makeDeps passes no accountScopeKey → the ledger persists under the unscoped key.
    const persisted = storage.map.get(REQUESTS_STORAGE_KEY)
    expect(persisted ?? {}).toEqual({})
  })
})

describe("F1: ledger register() is atomic under concurrency", () => {
  it("collapses two concurrent sightings of one request to a single 'new'", async () => {
    // Storage whose every read waits on a released gate — maximizes the interleaving window
    // the old check-then-write raced through.
    const gate: { release?: () => void } = {}
    const barrier = new Promise<void>((resolve) => {
      gate.release = resolve
    })
    const backing = makeMemoryStorage()
    const storage = {
      loadJson: async (key: string) => {
        await barrier
        return backing.loadJson(key)
      },
      saveJson: backing.saveJson,
    }

    const ledger = createRequestLedger(storage)
    const first = ledger.register("pk", "same-id")
    const second = ledger.register("pk", "same-id")
    gate.release?.()
    // Let both reads observe the pre-write map before either write lands.
    await Promise.resolve()
    await Promise.resolve()
    gate.release?.()

    const results = await Promise.all([first, second])
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual(["new", "pending-duplicate"])
  })

  it("evicts the OLDEST entries beyond REQUESTS_MAX_ENTRIES", async () => {
    const ledger = createRequestLedger(makeMemoryStorage())
    for (let i = 0; i < REQUESTS_MAX_ENTRIES + 5; i += 1) {
      await ledger.register("pk", `id-${i}`)
    }
    // Oldest evicted…
    expect(await ledger.lookup("pk", "id-0")).toBeNull()
    expect(await ledger.lookup("pk", "id-4")).toBeNull()
    // …newest retained.
    const kept = await ledger.lookup("pk", `id-${REQUESTS_MAX_ENTRIES + 4}`)
    expect(kept?.state).toBe("pending")
  })
})

describe("F2a: a throwing post-admit handler cannot strand a pending entry", () => {
  it("resolves a malformed sign_event request with an error instead of hanging the ledger", async () => {
    const present = jest.fn(async () => undefined)
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: { id: "bad-1", method: "sign_event", params: ["{not-json"] },
    })
    const runtime = createSignerRuntime(makeDeps({ present, decodeForTest }))
    await runtime.grantForTest(clientPubkey, [])

    await expect(
      runtime.handleInbound(makeInbound("verified") as never),
    ).resolves.toBeUndefined()
    expect(present).not.toHaveBeenCalled() // malformed → rejected BEFORE any approval surface

    // The rejection is visible as activity, and the entry resolved (no stranded pending):
    // a redelivery of the SAME id replays the stored error rather than surfacing again.
    const activity = await runtime.listActivity(clientPubkey)
    expect(activity.some((e) => e.method === "sign_event" && !e.accepted)).toBe(true)
    await runtime.handleInbound(makeInbound("verified") as never)
    await flushAsync()
    expect(present).not.toHaveBeenCalled()
  })
})

describe("F2b: a presented approval times out (auto-reject)", () => {
  it("auto-rejects the active entry after approvalTimeoutMs and advances the FIFO", async () => {
    const presented: ApprovalEntry[] = []
    const decisions: string[] = []
    const coordinator = createApprovalCoordinator({
      present: async (entry) => {
        presented.push(entry)
      },
      approvalTimeoutMs: 20,
    })

    // Track each entry's resolution independently — Promise.all would only settle once BOTH
    // timed out, which is exactly the sequencing under test (first fires at ~20ms, second at
    // ~40ms after it surfaces).
    const track = (pending: Promise<{ approved: boolean }>, label: string): void => {
      pending.then((d) => decisions.push(`${label}:${d.approved}`)).catch(() => undefined)
    }
    track(
      coordinator.enqueue({
        id: "e1",
        kind: "request",
        clientPubkey: "pk",
        method: "nip44_decrypt",
        humanAction: "decrypt",
      }),
      "e1",
    )
    track(
      coordinator.enqueue({
        id: "e2",
        kind: "request",
        clientPubkey: "pk",
        method: "nip44_decrypt",
        humanAction: "decrypt",
      }),
      "e2",
    )

    // First surfaces; nobody answers it → the timer must reject it and surface the second.
    await new Promise((resolve) => {
      setTimeout(resolve, 30)
    })
    expect(decisions).toEqual(["e1:false"])
    expect(presented).toHaveLength(2)

    // The second then also auto-rejects; nothing is pinned.
    await new Promise((resolve) => {
      setTimeout(resolve, 40)
    })
    expect(decisions).toEqual(["e1:false", "e2:false"])
    expect(coordinator.activeEntry()).toBeNull()
  })
})

describe("bounds: decoded-field size caps (nip46-codec)", () => {
  const transportSk = generateSecretKey()
  const transportSkHex = Buffer.from(transportSk).toString("hex")
  const conversationKey = nip44.getConversationKey(
    hexToBytes(transportSkHex),
    clientPubkey,
  )

  const encryptedRequest = (body: unknown): string =>
    nip44.encrypt(JSON.stringify(body), conversationKey)

  it("decodes a well-formed request", () => {
    const event = makeInbound(
      encryptedRequest({ id: "ok-1", method: "ping", params: [] }),
    ) as Parameters<typeof decodeRequest>[0]
    expect(decodeRequest(event, transportSkHex).request.method).toBe("ping")
  })

  it("throws on an oversized id (never persisted/rendered)", () => {
    const event = makeInbound(
      encryptedRequest({ id: "x".repeat(257), method: "ping", params: [] }),
    ) as Parameters<typeof decodeRequest>[0]
    expect(() => decodeRequest(event, transportSkHex)).toThrow(/size limits/)
  })

  it("throws on an oversized param (attacker-inflated payload)", () => {
    const event = makeInbound(
      encryptedRequest({ id: "ok", method: "sign_event", params: ["y".repeat(131_073)] }),
    ) as Parameters<typeof decodeRequest>[0]
    expect(() => decodeRequest(event, transportSkHex)).toThrow(/size limits/)
  })
})
