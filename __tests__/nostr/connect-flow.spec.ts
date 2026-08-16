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

const uriWith = (opts: { secret?: string; perms?: string } = {}) => {
  const secret = opts.secret ?? "sekret-42"
  const perms = opts.perms ? `&perms=${encodeURIComponent(opts.perms)}` : ""
  return (
    `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr.example&secret=${secret}` +
    `&name=Damus${perms}`
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
    expect(ack.secret).toBe("VERBATIM-SECRET-123")
    expect(ack.clientPubkey).toBe(CLIENT)
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

describe("ConnectFlow: mandatory secret (AC #2, Mike Dilger)", () => {
  it("a secret-less URI is rejected BEFORE any approval is raised", async () => {
    const { flow, requestApproval, sendConnectAck, sendRejection } = makeFlow(true)
    await flow.handleConnect(`nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr&name=Damus`)
    expect(requestApproval).not.toHaveBeenCalled()
    expect(sendConnectAck).not.toHaveBeenCalled()
    expect(sendRejection).not.toHaveBeenCalled() // no surface, no side effects
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
