/**
 * Story A1 — signer runtime assembly.
 *
 * The runtime is the ONE place that constructs the concrete ports (relay pool, connection
 * store, signer seam, approval coordinator, pipeline + dispatcher, connect-flow, sign/encrypt
 * flows) and holds them together as a single handle. It is framework-agnostic (no RN/UI, AD-1)
 * so the assembly is unit-testable without a socket or the keychain.
 *
 * These tests assert the wiring contracts:
 *  - inbound kind-24133 traffic flows through the ONE pipeline (verify → decode → dispatch);
 *  - approval-gated methods (sign_event, nip04/nip44) route through the SINGLE coordinator;
 *  - the fixed connect-time grant (sign_event:22242) passes through pre-approved (no surface);
 *  - a non-granted method raises exactly one surface on the shared coordinator;
 *  - the runtime exposes the SignerGateDeps shape the flag boundary controls.
 */
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure"

import { createSignerRuntime, type SignerRuntimeDeps } from "../../app/nostr/runtime"
import { NIP46_KIND } from "../../app/nostr/transport/nip46-codec"
import { __resetRelayPoolForTest } from "../../app/nostr/transport/relay-pool"
import { __resetApprovalCoordinatorForTest } from "../../app/nostr/approval/coordinator"

// A deterministic client identity for the inbound events.
const clientSk = generateSecretKey()
const clientPubkey = getPublicKey(clientSk)

// An in-memory storage port for the ConnectionStore (no react-native-keychain / MMKV).
const makeMemoryStorage = () => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (key: string) => map.get(key) ?? null,
    saveJson: async (key: string, value: unknown) => {
      map.set(key, value)
    },
  }
}

// A fake relay pool that captures published events and lets tests inject inbound traffic.
const makeFakePool = () => {
  const published: unknown[] = []
  let onEvent: ((event: unknown) => void) | null = null
  const pool = {
    subscribe: (
      _relays: string[],
      _filter: Record<string, unknown>,
      params: Record<string, unknown>,
    ) => {
      onEvent = params.onevent as (event: unknown) => void
      return { close: () => undefined }
    },
    publish: (_relays: string[], event: unknown) => {
      published.push(event)
      return [Promise.resolve("ok")]
    },
    ensureRelay: (_url: string) => Promise.resolve({}),
    close: () => undefined,
    destroy: () => undefined,
  }
  return { pool, published, inject: (e: unknown) => onEvent?.(e) }
}

// A fixed local identity (the "user") the runtime signs as.
const userSk = generateSecretKey()
const readNsecHex = async () => Buffer.from(userSk).toString("hex")

const makeDeps = (over: Partial<SignerRuntimeDeps> = {}): SignerRuntimeDeps => ({
  readNsecHex,
  storage: makeMemoryStorage(),
  createPool: () => makeFakePool().pool,
  log: () => undefined,
  ...over,
})

// Events arrive over the wire as plain JSON — never carrying nostr-tools' internal
// verifiedSymbol cache. Round-trip through JSON so verifyEvent does a REAL BIP-340 check
// (the explicit verify stage must never trust an implicit "already verified" flag).
const asWireEvent = (event: unknown) => JSON.parse(JSON.stringify(event))

// Build a signed kind-24133 request event from the client to the user's transport pubkey.
const makeInbound = (payloadCiphertext: string) =>
  asWireEvent(
    finalizeEvent(
      {
        kind: NIP46_KIND,
        // eslint-disable-next-line camelcase
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: payloadCiphertext,
      },
      clientSk,
    ),
  )

beforeEach(() => {
  __resetRelayPoolForTest()
  // The approval coordinator is a process singleton; reset it so an unresolved surface from a
  // prior test (approval-gated flows intentionally leave handleInbound pending) does not pause
  // the queue for the next test's enqueue → pump → present path.
  __resetApprovalCoordinatorForTest()
})

describe("signer runtime assembly (A1)", () => {
  it("constructs a runtime exposing the SignerGateDeps shape (connectionStore/relayPool/entryPoints)", () => {
    const runtime = createSignerRuntime(makeDeps())
    expect(typeof runtime.gateDeps.connectionStore.list).toBe("function")
    expect(typeof runtime.gateDeps.relayPool.openForConnections).toBe("function")
    expect(typeof runtime.gateDeps.relayPool.closeAll).toBe("function")
    expect(typeof runtime.gateDeps.entryPoints.activate).toBe("function")
    expect(typeof runtime.gateDeps.entryPoints.deactivate).toBe("function")
  })

  it("the gate NEVER exposes a clear() on the connection store (records retained on flag toggle)", () => {
    const runtime = createSignerRuntime(makeDeps())
    expect(runtime.gateDeps.connectionStore.clear).toBeUndefined()
  })

  it("exposes a single handleInbound pipeline entry and a connect entry point", () => {
    const runtime = createSignerRuntime(makeDeps())
    expect(typeof runtime.handleInbound).toBe("function")
    expect(typeof runtime.handleConnectUri).toBe("function")
  })

  it("drops non-24133 inbound without touching decode/dispatch (kind gate)", async () => {
    const decode = jest.fn()
    const runtime = createSignerRuntime(makeDeps({ decodeForTest: decode }))
    await runtime.handleInbound({ kind: 1, pubkey: clientPubkey } as never)
    expect(decode).not.toHaveBeenCalled()
  })

  it("drops an inbound event that fails BIP-340 verify BEFORE decode (verify-first)", async () => {
    const decode = jest.fn()
    const runtime = createSignerRuntime(makeDeps({ decodeForTest: decode }))
    // Tamper the content AFTER signing → the signature no longer matches the recomputed id, so
    // BIP-340 verify must fail and decode must never run (matches pipeline-verify.spec pattern).
    const tampered = { ...makeInbound("x"), content: "tampered-after-signing" }
    await runtime.handleInbound(tampered as never)
    expect(decode).not.toHaveBeenCalled()
  })

  it("routes a decoded sign_event through the ONE coordinator (pre-approved by the connect grant)", async () => {
    const present = jest.fn(async () => undefined)
    // Decoded-request stub: a verified sign_event from a granted client.
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: {
        id: "req-1",
        method: "sign_event",
        params: [JSON.stringify({ kind: 22242, content: "", tags: [] })],
      },
    })
    const runtime = createSignerRuntime(makeDeps({ present, decodeForTest }))
    // Grant sign_event:22242 to this client first (simulating a completed connect).
    await runtime.grantForTest(clientPubkey, ["sign_event:22242"])

    const evt = makeInbound("verified")
    await runtime.handleInbound(evt as never)

    // Pre-approved by the fixed grant → NO surface presented.
    expect(present).not.toHaveBeenCalled()
  })

  it("raises exactly one surface for a non-granted approval-gated method", async () => {
    const present = jest.fn(async () => undefined)
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: {
        id: "req-2",
        method: "nip44_decrypt",
        params: [clientPubkey, "ciphertext"],
      },
    })
    const runtime = createSignerRuntime(makeDeps({ present, decodeForTest }))
    // No grant covers nip44_decrypt (only sign_event:22242 is grantable) → one surface. The
    // handleInbound promise stays PENDING until the human resolves the surface (correct: the
    // request blocks on approval), so we deliberately do NOT await it — attach a catch only to
    // avoid an unhandled rejection, then assert exactly one surface was presented.
    const evt = makeInbound("verified")
    runtime.handleInbound(evt as never).catch(() => undefined)
    // Let the microtask queue flush the enqueue → pump → present path.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(present).toHaveBeenCalledTimes(1)
  })

  it("does NOT raise a SECOND surface when the SAME request id is re-delivered while pending (fix #6)", async () => {
    const present = jest.fn(async () => undefined)
    // Same decoded request id on every delivery — this is what the STAGE_TIMEOUT retry looks
    // like: the client re-publishes the same kind-24133 event ~10s later.
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: {
        id: "retry-1",
        method: "nip44_decrypt",
        params: [clientPubkey, "ciphertext"],
      },
    })
    const runtime = createSignerRuntime(makeDeps({ present, decodeForTest }))

    // First delivery: raises exactly one surface (stays pending on approval).
    runtime.handleInbound(makeInbound("verified") as never).catch(() => undefined)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(present).toHaveBeenCalledTimes(1)

    // Retry while the first surface is still open (pending) → ledger returns pending-duplicate,
    // the flow drops it, and NO second surface is presented.
    runtime.handleInbound(makeInbound("verified") as never).catch(() => undefined)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(present).toHaveBeenCalledTimes(1)
  })

  it("listConnections + disconnect manage the store (fix #3)", async () => {
    const runtime = createSignerRuntime(makeDeps())
    await runtime.grantForTest(clientPubkey, ["sign_event:22242"])

    // The granted client is listed.
    let list = await runtime.listConnections()
    expect(list.map((r) => r.clientPubkey)).toContain(clientPubkey)

    // Disconnect actually removes it (atomic delete + tombstone).
    await runtime.disconnect(clientPubkey)
    list = await runtime.listConnections()
    expect(list.map((r) => r.clientPubkey)).not.toContain(clientPubkey)
  })
})
