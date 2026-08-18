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

// Let the microtask + 0ms-timer queue drain (enqueue → pump → present → activity record).
const flushAsync = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

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
    await flushAsync()
    expect(present).toHaveBeenCalledTimes(1)

    // Retry while the first surface is still open (pending) → ledger returns pending-duplicate,
    // the flow drops it, and NO second surface is presented.
    runtime.handleInbound(makeInbound("verified") as never).catch(() => undefined)
    await flushAsync()
    expect(present).toHaveBeenCalledTimes(1)
  })

  it("clears the sign-in waiting overlay when a general client sends a capability op (Ditto fix)", async () => {
    const present = jest.fn(async () => undefined)
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: {
        id: "cap-1",
        method: "nip44_decrypt",
        params: [clientPubkey, "ciphertext"],
      },
    })
    const runtime = createSignerRuntime(makeDeps({ present, decodeForTest }))
    // Simulate the post-connect waiting overlay being up for this client.
    runtime.awaitingFollowup.set({ clientPubkey, name: "Ditto" })
    expect(runtime.awaitingFollowup.current()?.clientPubkey).toBe(clientPubkey)

    // A nip44_decrypt is a general-client signal (no login challenge coming) → overlay clears
    // immediately, even though the approval surface itself stays pending on the human.
    runtime.handleInbound(makeInbound("verified") as never).catch(() => undefined)
    await flushAsync()

    expect(runtime.awaitingFollowup.current()).toBeNull()
    expect(present).toHaveBeenCalledTimes(1) // the op still raises its own approval surface
  })

  it("does NOT clear the waiting overlay for a sign_event challenge that is still pending approval", async () => {
    const present = jest.fn(async () => undefined)
    // Non-granted sign_event → the surface stays PENDING on the human, so the sign path's own
    // confirmed-publish clear (runSignEvent) has not fired. The capability early-clear must NOT
    // apply to a sign_event, so the overlay stays up while the login challenge awaits approval.
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: {
        id: "sign-1",
        method: "sign_event",
        params: [JSON.stringify({ kind: 9999, content: "", tags: [] })],
      },
    })
    const runtime = createSignerRuntime(makeDeps({ present, decodeForTest }))
    runtime.awaitingFollowup.set({ clientPubkey, name: "vezir" })

    runtime.handleInbound(makeInbound("verified") as never).catch(() => undefined)
    await flushAsync()

    expect(present).toHaveBeenCalledTimes(1) // sign_event challenge is surfaced (not pre-granted)
    expect(runtime.awaitingFollowup.current()?.clientPubkey).toBe(clientPubkey) // overlay stays up
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

  it("records a 'get_public_key' activity entry ('Read your public key', Amber parity)", async () => {
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: { id: "gpk-1", method: "get_public_key", params: [] },
    })
    const runtime = createSignerRuntime(makeDeps({ decodeForTest }))
    await runtime.handleInbound(makeInbound("verified") as never)
    await flushAsync()
    const activity = await runtime.listActivity(clientPubkey)
    expect(activity.some((e) => e.method === "get_public_key" && e.accepted)).toBe(true)
  })

  it("connect approve records a 'connect' activity entry AND begins awaiting the login follow-up", async () => {
    // A present that auto-approves the connection entry the instant it is presented. A holder lets
    // the present closure reach the runtime that is constructed WITH it (chicken-and-egg).
    const holder: { runtime?: ReturnType<typeof createSignerRuntime> } = {}
    const present = jest.fn(async () => {
      holder.runtime?.coordinator.resolveActive({ approved: true })
    })
    const runtime = createSignerRuntime(makeDeps({ present }))
    holder.runtime = runtime

    const uri =
      `nostrconnect://${clientPubkey}` +
      `?relay=wss%3A%2F%2Fnos.lol&secret=s&name=BTCPay%20Server&perms=sign_event%3A22242`
    await runtime.handleConnectUri(uri)
    await flushAsync()

    const activity = await runtime.listActivity(clientPubkey)
    expect(activity.some((e) => e.method === "connect" && e.accepted)).toBe(true)
    // We are now waiting on this client's login sign_event.
    expect(runtime.awaitingFollowup.current()).toMatchObject({
      clientPubkey,
      name: "BTCPay Server",
    })
  })

  it("connects a SECRET-LESS URI with a metadata= blob (Plebeian interop) and stores its identity", async () => {
    const holder: { runtime?: ReturnType<typeof createSignerRuntime> } = {}
    const present = jest.fn(async () => {
      holder.runtime?.coordinator.resolveActive({ approved: true })
    })
    const runtime = createSignerRuntime(makeDeps({ present }))
    holder.runtime = runtime

    const blob = encodeURIComponent(
      JSON.stringify({ name: "Plebeian.market", url: "https://plebeian.market" }),
    )
    // No secret=, token= present (ignored) — the shape Plebeian.market emits.
    await runtime.handleConnectUri(
      `nostrconnect://${clientPubkey}?relay=wss%3A%2F%2Fnos.lol&metadata=${blob}&token=abc`,
    )
    await flushAsync()

    const records = await runtime.listConnections()
    const rec = records.find((r) => r.clientPubkey === clientPubkey)
    expect(rec).toBeTruthy()
    expect(rec?.metadata.name).toBe("Plebeian.market")
    expect(rec?.metadata.url).toBe("https://plebeian.market")
  })

  it("pre-approves a 27235 sign when the u-host matches the connect url (Plan A one-tap)", async () => {
    const present = jest.fn(async () => undefined)
    // Grant sign_event:27235 origin-bound to vezir.twentyone.ist (simulating a completed connect
    // that carried url=). grantForTest only stores 22242, so upsert the record directly via a
    // connect: use decodeForTest for the 27235 sign and seed the store through handleConnectUri.
    const holder: { runtime?: ReturnType<typeof createSignerRuntime> } = {}
    const present2 = jest.fn(async () => {
      holder.runtime?.coordinator.resolveActive({ approved: true })
    })
    const uHostEvent = JSON.stringify({
      kind: 27235,
      content: "",
      tags: [
        ["u", "https://vezir.twentyone.ist/api/auth/nostr/login"],
        ["method", "POST"],
      ],
    })
    let phase: "connect" | "sign" = "connect"
    const decodeForTest = () =>
      phase === "sign"
        ? {
            scheme: "nip44" as const,
            clientPubkey,
            request: { id: "sign-27235", method: "sign_event", params: [uHostEvent] },
          }
        : {
            scheme: "nip44" as const,
            clientPubkey,
            request: { id: "gpk", method: "get_public_key", params: [] },
          }
    const runtime = createSignerRuntime(
      makeDeps({ present: present2, decodeForTest, readTransportSkHex: readNsecHex }),
    )
    holder.runtime = runtime

    // Connect with url + perms=27235 → origin-bound grant stored.
    await runtime.handleConnectUri(
      `nostrconnect://${clientPubkey}?relay=wss%3A%2F%2Fr.example&secret=s` +
        `&name=vezir&perms=sign_event%3A27235&url=${encodeURIComponent(
          "https://vezir.twentyone.ist",
        )}`,
    )
    await flushAsync()

    // Now deliver the 27235 sign_event — it must be pre-approved (NO surface).
    phase = "sign"
    present.mockClear()
    await runtime.handleInbound(makeInbound("verified") as never)
    await flushAsync()
    expect(present2).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "request" }),
    )
  })

  it("sliding window: an inbound request from the awaited client keeps the waiting overlay up past the idle window", async () => {
    // Real timers to drive the runtime's setTimeout-based idle window deterministically via fake
    // timers scoped to THIS test only.
    jest.useFakeTimers()
    try {
      const holder: { runtime?: ReturnType<typeof createSignerRuntime> } = {}
      const present = jest.fn(async (entry: { kind: string }) => {
        if (entry.kind === "connection")
          holder.runtime?.coordinator.resolveActive({ approved: true })
      })
      let phase: "connect" | "gpk" = "connect"
      const decodeForTest = () => ({
        scheme: "nip44" as const,
        clientPubkey,
        request:
          phase === "gpk"
            ? { id: "gpk-late", method: "get_public_key", params: [] }
            : { id: "gpk-0", method: "get_public_key", params: [] },
      })
      const runtime = createSignerRuntime(
        makeDeps({ present, decodeForTest, readTransportSkHex: readNsecHex }),
      )
      holder.runtime = runtime

      await runtime.handleConnectUri(
        `nostrconnect://${clientPubkey}?relay=wss%3A%2F%2Fr.example&secret=s&name=vezir&perms=sign_event%3A27235`,
      )
      // Flush the connect microtasks under fake timers.
      await Promise.resolve()
      await Promise.resolve()
      expect(runtime.awaitingFollowup.current()).not.toBeNull()

      // Advance to just before the 90s idle window; still waiting.
      jest.advanceTimersByTime(80_000)
      expect(runtime.awaitingFollowup.current()).not.toBeNull()

      // A late get_public_key arrives → resets the idle window.
      phase = "gpk"
      await runtime.handleInbound(makeInbound("verified") as never)
      await Promise.resolve()

      // Advance another 80s (past the ORIGINAL 90s from connect, but within the reset window).
      jest.advanceTimersByTime(80_000)
      expect(runtime.awaitingFollowup.current()).not.toBeNull() // still up — window slid

      // No further activity → the idle window finally elapses → cleared.
      jest.advanceTimersByTime(90_000)
      expect(runtime.awaitingFollowup.current()).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it("raises a surface for a 27235 sign whose u-host differs from the connect url (mismatch prompts)", async () => {
    const holder: { runtime?: ReturnType<typeof createSignerRuntime> } = {}
    const present = jest.fn(async (entry: { kind: string }) => {
      // Auto-approve only the connection entry; leave a request surface pending (counts it).
      if (entry.kind === "connection")
        holder.runtime?.coordinator.resolveActive({ approved: true })
    })
    const evilEvent = JSON.stringify({
      kind: 27235,
      content: "",
      tags: [
        ["u", "https://evil.example/login"],
        ["method", "POST"],
      ],
    })
    let phase: "connect" | "sign" = "connect"
    const decodeForTest = () =>
      phase === "sign"
        ? {
            scheme: "nip44" as const,
            clientPubkey,
            request: { id: "sign-evil", method: "sign_event", params: [evilEvent] },
          }
        : {
            scheme: "nip44" as const,
            clientPubkey,
            request: { id: "gpk2", method: "get_public_key", params: [] },
          }
    const runtime = createSignerRuntime(
      makeDeps({ present, decodeForTest, readTransportSkHex: readNsecHex }),
    )
    holder.runtime = runtime

    await runtime.handleConnectUri(
      `nostrconnect://${clientPubkey}?relay=wss%3A%2F%2Fr.example&secret=s` +
        `&name=vezir&perms=sign_event%3A27235&url=${encodeURIComponent(
          "https://vezir.twentyone.ist",
        )}`,
    )
    await flushAsync()

    phase = "sign"
    const connectionCalls = present.mock.calls.length
    runtime.handleInbound(makeInbound("verified") as never).catch(() => undefined)
    await flushAsync()
    // A NEW (request) surface was presented for the mismatched-host 27235 sign.
    expect(present.mock.calls.length).toBeGreaterThan(connectionCalls)
  })
})
