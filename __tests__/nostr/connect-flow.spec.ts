/**
 * Story 3.3 — ConnectFlow handshake (AC #1-#8, AD-8/AD-9).
 *
 * ConnectFlow owns the nostrconnect:// handshake: parse → raise CONNECTION approval THROUGH
 * the ApprovalCoordinator port (never a surface directly) → on approve, send a connect-ack
 * echoing the secret VERBATIM and create the ConnectionStore record ONLY on echo → on reject,
 * no record + spec rejection. The v1 grant is EXACTLY sign_event:22242. Re-connect replaces
 * only after fresh approval. Never-connected pubkeys are dropped without response.
 *
 * Framework-agnostic (transport, AD-1): the approval coordinator, ack/reject senders, and the
 * store are injected ports — no UI, no relay.
 */
import {
  createConnectFlow,
  type ConnectAck,
  type ConnectionApprovalRequest,
} from "../../app/nostr/transport/connect-flow"
import {
  createConnectionStore,
  GRANTABLE_SCOPE,
  type ConnectionStorage,
} from "../../app/nostr/core/connection-store"

const CLIENT = "cafe".repeat(16)
const memory = (): ConnectionStorage => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (k) => (map.has(k) ? map.get(k) : null),
    saveJson: async (k, v) => {
      map.set(k, JSON.parse(JSON.stringify(v)))
    },
  }
}

const uriWith = (opts: { secret?: string; perms?: string; url?: string } = {}) => {
  const secret = opts.secret ?? "sekret-42"
  const perms = opts.perms ? `&perms=${encodeURIComponent(opts.perms)}` : ""
  const url = opts.url ? `&url=${encodeURIComponent(opts.url)}` : ""
  return (
    `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr.example&secret=${secret}` +
    `&name=Damus${perms}${url}`
  )
}

/** Build a ConnectFlow with injected ports; approval decision is controllable per test. */
const makeFlow = (approve: boolean, over: Record<string, unknown> = {}) => {
  const store = createConnectionStore(memory())
  const requestApproval = jest.fn(async (_req: ConnectionApprovalRequest) => ({
    approved: approve,
  }))
  const sendConnectAck = jest.fn((_ack: ConnectAck) => undefined)
  const sendRejection = jest.fn((_pk: string) => undefined)
  const flow = createConnectFlow({
    store,
    requestApproval,
    sendConnectAck,
    sendRejection,
    ...over,
  })
  return { flow, store, requestApproval, sendConnectAck, sendRejection }
}

describe("ConnectFlow: approve path (AC #1/#2/#3/#5)", () => {
  it("raises a CONNECTION approval carrying client identity + human perms, ZERO raw scope", async () => {
    const { flow, requestApproval } = makeFlow(true)
    await flow.handleConnect(uriWith({ perms: "sign_event:22242" }))
    expect(requestApproval).toHaveBeenCalledTimes(1)
    const decision = requestApproval.mock.calls[0][0]
    expect(decision).toMatchObject({ kind: "connection", clientPubkey: CLIENT })
    // no raw scope string leaks into the decision payload surfaced to the human
    expect(JSON.stringify(decision)).not.toContain("sign_event:22242")
  })

  it("on approve, sends connect-ack echoing the secret VERBATIM", async () => {
    const { flow, sendConnectAck } = makeFlow(true)
    await flow.handleConnect(uriWith({ secret: "VERBATIM-SECRET-123" }))
    expect(sendConnectAck).toHaveBeenCalledTimes(1)
    const ack = sendConnectAck.mock.calls[0][0]
    expect(ack.result).toBe("VERBATIM-SECRET-123")
    expect(ack.clientPubkey).toBe(CLIENT)
  })

  it("on approve of a SECRET-LESS URI, the ack result is the literal 'ack' (interop)", async () => {
    const store = createConnectionStore(memory())
    const sendConnectAck = jest.fn()
    const flow = createConnectFlow({
      store,
      requestApproval: async () => ({ approved: true }),
      sendConnectAck,
      sendRejection: jest.fn(),
    })
    // A secret-less nostrconnect URI (Plebeian-style).
    await flow.handleConnect(`nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr&name=Pleb`)
    expect(sendConnectAck).toHaveBeenCalledTimes(1)
    expect(sendConnectAck.mock.calls[0][0].result).toBe("ack")
    // The connection is still recorded (approval was the gate).
    expect(await store.get(CLIENT)).not.toBeNull()
  })

  it("grants scopes parsed from a metadata= blob when no top-level perms= is present", async () => {
    const store = createConnectionStore(memory())
    const flow = createConnectFlow({
      store,
      requestApproval: async () => ({ approved: true }),
      sendConnectAck: jest.fn(),
      sendRejection: jest.fn(),
    })
    const blob = JSON.stringify({
      name: "Pleb",
      url: "https://plebeian.market",
      perms: "sign_event:27235,get_public_key",
    })
    await flow.handleConnect(
      `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr&metadata=${encodeURIComponent(blob)}`,
    )
    const rec = await store.get(CLIENT)
    expect(rec?.grantedScopes).toEqual(["sign_event:27235"]) // intersected from blob perms
    expect(rec?.metadata.url).toBe("https://plebeian.market")
  })

  it("creates the ConnectionStore record ONLY after the echo is sent", async () => {
    const order: string[] = []
    const store = createConnectionStore(memory())
    const origUpsert = store.upsert.bind(store)
    jest.spyOn(store, "upsert").mockImplementation(async (r) => {
      order.push("upsert")
      return origUpsert(r)
    })
    const sendConnectAck = jest.fn(() => order.push("ack"))
    const flow = createConnectFlow({
      store,
      requestApproval: async () => ({ approved: true }),
      sendConnectAck,
      sendRejection: jest.fn(),
    })
    await flow.handleConnect(uriWith())
    expect(order).toEqual(["ack", "upsert"]) // echo THEN record
    expect(await store.get(CLIENT)).toBeTruthy()
  })

  it("grants EXACTLY sign_event:22242, dropping any other requested perm (AC #5)", async () => {
    const { flow, store } = makeFlow(true)
    await flow.handleConnect(
      uriWith({ perms: "sign_event:22242,nip44_decrypt,wipe_disk" }),
    )
    const rec = await store.get(CLIENT)
    expect(rec?.grantedScopes).toEqual([GRANTABLE_SCOPE])
  })

  it("grants empty scope when sign_event:22242 was not requested", async () => {
    const { flow, store } = makeFlow(true)
    await flow.handleConnect(uriWith({ perms: "nip44_decrypt" }))
    expect((await store.get(CLIENT))?.grantedScopes).toEqual([])
  })

  it("grants sign_event:27235 when requested (vezir), dropping non-grantable perms (Plan A)", async () => {
    const { flow, store } = makeFlow(true)
    await flow.handleConnect(
      uriWith({
        perms: "sign_event:27235,get_public_key",
        url: "https://vezir.twentyone.ist",
      }),
    )
    const rec = await store.get(CLIENT)
    expect(rec?.grantedScopes).toEqual(["sign_event:27235"]) // get_public_key not grantable
  })

  it("stores metadata.url so the 27235 grant can origin-bind at policy time", async () => {
    const { flow, store } = makeFlow(true)
    await flow.handleConnect(
      uriWith({ perms: "sign_event:27235", url: "https://vezir.twentyone.ist" }),
    )
    expect(await store.grantedOrigin(CLIENT)).toBe("vezir.twentyone.ist")
  })

  it("surfaces the host in human perms for a 27235 request, with NO raw scope leaked", async () => {
    const { flow, requestApproval } = makeFlow(true)
    await flow.handleConnect(
      uriWith({ perms: "sign_event:27235", url: "https://vezir.twentyone.ist" }),
    )
    const decision = requestApproval.mock.calls[0][0] as { humanPerms: string[] }
    expect(decision.humanPerms).toContain("sign-in-http:vezir.twentyone.ist")
    expect(JSON.stringify(decision)).not.toContain("sign_event:27235")
  })
})

describe("ConnectFlow: reject path (AC #3)", () => {
  it("on reject, writes NO record and sends the spec rejection", async () => {
    const { flow, store, sendRejection, sendConnectAck } = makeFlow(false)
    await flow.handleConnect(uriWith())
    expect(await store.get(CLIENT)).toBeNull()
    expect(sendConnectAck).not.toHaveBeenCalled()
    expect(sendRejection).toHaveBeenCalledTimes(1)
  })
})

describe("ConnectFlow: optional secret (interop) + secret confinement", () => {
  it("a secret-less URI STILL raises the connection approval (the human tap is the gate)", async () => {
    const { flow, requestApproval, sendConnectAck } = makeFlow(true)
    await flow.handleConnect(`nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr&name=Damus`)
    expect(requestApproval).toHaveBeenCalledTimes(1)
    expect(sendConnectAck).toHaveBeenCalledTimes(1) // acked after approval
  })

  it("never persists the secret to the ConnectionStore record", async () => {
    const { flow, store } = makeFlow(true)
    await flow.handleConnect(uriWith({ secret: "TRANSIENT" }))
    const rec = await store.get(CLIENT)
    expect(JSON.stringify(rec)).not.toContain("TRANSIENT")
  })
})

describe("ConnectFlow: re-connect replaces only after fresh approval (AC #6)", () => {
  it("re-connect WITHOUT approval leaves the old record intact", async () => {
    const store = createConnectionStore(memory())
    const flowApprove = createConnectFlow({
      store,
      requestApproval: async () => ({ approved: true }),
      sendConnectAck: jest.fn(),
      sendRejection: jest.fn(),
    })
    await flowApprove.handleConnect(uriWith())
    const first = await store.get(CLIENT)

    const flowReject = createConnectFlow({
      store,
      requestApproval: async () => ({ approved: false }),
      sendConnectAck: jest.fn(),
      sendRejection: jest.fn(),
    })
    await flowReject.handleConnect(uriWith())
    expect(await store.get(CLIENT)).toEqual(first) // untouched
  })

  it("re-connect WITH fresh approval replaces the record", async () => {
    const store = createConnectionStore(memory())
    const mk = () =>
      createConnectFlow({
        store,
        requestApproval: async () => ({ approved: true }),
        sendConnectAck: jest.fn(),
        sendRejection: jest.fn(),
      })
    await mk().handleConnect(uriWith())
    await mk().handleConnect(
      `nostrconnect://${CLIENT}?relay=wss%3A%2F%2FNEW.relay&secret=s2&name=Damus`,
    )
    expect((await store.get(CLIENT))?.relays).toEqual(["wss://NEW.relay"])
  })
})

describe("ConnectFlow: same-identity re-login dedupe (fix #4)", () => {
  const OLD_PK = "aaaa".repeat(16)
  const NEW_PK = "bbbb".repeat(16)
  // Same identity (name=Damus), different ephemeral pubkeys.
  const uriFor = (pk: string) =>
    `nostrconnect://${pk}?relay=wss%3A%2F%2Fr.example&secret=s&name=Damus`

  const makeDedupeFlow = (resolution: "replace" | "keep" | "cancel") => {
    const store = createConnectionStore(memory())
    const resolveDuplicate = jest.fn(async () => resolution)
    const sendRejection = jest.fn()
    const flow = createConnectFlow({
      store,
      requestApproval: async () => ({ approved: true }),
      resolveDuplicate,
      sendConnectAck: jest.fn(),
      sendRejection,
    })
    return { flow, store, resolveDuplicate, sendRejection }
  }

  it("does NOT prompt on the FIRST connection (no existing identity)", async () => {
    const { flow, resolveDuplicate, store } = makeDedupeFlow("keep")
    await flow.handleConnect(uriFor(NEW_PK))
    expect(resolveDuplicate).not.toHaveBeenCalled()
    expect(await store.get(NEW_PK)).not.toBeNull()
  })

  it("REPLACE disconnects the old record and keeps only the new one", async () => {
    const { flow, resolveDuplicate, store } = makeDedupeFlow("replace")
    await flow.handleConnect(uriFor(OLD_PK))
    await flow.handleConnect(uriFor(NEW_PK))
    expect(resolveDuplicate).toHaveBeenCalledTimes(1)
    expect(await store.get(OLD_PK)).toBeNull()
    expect(await store.get(NEW_PK)).not.toBeNull()
    expect(await store.list()).toHaveLength(1)
  })

  it("KEEP BOTH leaves both records connected", async () => {
    const { flow, store } = makeDedupeFlow("keep")
    await flow.handleConnect(uriFor(OLD_PK))
    await flow.handleConnect(uriFor(NEW_PK))
    expect(await store.get(OLD_PK)).not.toBeNull()
    expect(await store.get(NEW_PK)).not.toBeNull()
    expect(await store.list()).toHaveLength(2)
  })

  it("CANCEL writes no new record and sends a rejection (old survives)", async () => {
    const { flow, store, sendRejection } = makeDedupeFlow("cancel")
    await flow.handleConnect(uriFor(OLD_PK))
    await flow.handleConnect(uriFor(NEW_PK))
    expect(sendRejection).toHaveBeenCalledWith(NEW_PK)
    expect(await store.get(NEW_PK)).toBeNull()
    expect(await store.get(OLD_PK)).not.toBeNull()
    expect(await store.list()).toHaveLength(1)
  })

  it("without a resolveDuplicate port, a re-login just keeps both (back-compat)", async () => {
    const store = createConnectionStore(memory())
    const flow = createConnectFlow({
      store,
      requestApproval: async () => ({ approved: true }),
      sendConnectAck: jest.fn(),
      sendRejection: jest.fn(),
    })
    await flow.handleConnect(uriFor(OLD_PK))
    await flow.handleConnect(uriFor(NEW_PK))
    expect(await store.list()).toHaveLength(2)
  })
})
