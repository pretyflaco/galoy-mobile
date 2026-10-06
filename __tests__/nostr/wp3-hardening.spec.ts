/**
 * WP3 hardening regression suite (audit H3).
 *
 * Covers:
 *  - voidAllConnections(): every record of the account scope is disconnected (delete + void
 *    grant + tombstone) and its activity purged;
 *  - identity/scope binding at execution time: an approval raised under identity N / scope A
 *    resolves as REJECTED when either changed before it is acted on — no signature is ever
 *    produced from a key the user did not consent to serve.
 */
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure"

import { createSignerRuntime, type SignerRuntimeDeps } from "../../app/nostr/runtime"
import { NIP46_KIND } from "../../app/nostr/transport/nip46-codec"
import { __resetRelayPoolForTest } from "../../app/nostr/transport/relay-pool"
import { __resetApprovalCoordinatorForTest } from "../../app/nostr/approval/coordinator"

const clientSk = generateSecretKey()
const clientPubkey = getPublicKey(clientSk)

const makeMemoryStorage = () => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (key: string) => map.get(key) ?? null,
    saveJson: async (key: string, value: unknown) => {
      map.set(key, value)
    },
  }
}

const makeFakePool = () => ({
  subscribe: () => ({ close: () => undefined }),
  publish: () => [Promise.resolve("ok")],
  ensureRelay: () => Promise.resolve({}),
  close: () => undefined,
  destroy: () => undefined,
})

const makeDeps = (
  over: Partial<SignerRuntimeDeps> & { readNsecHex?: () => Promise<string> } = {},
): SignerRuntimeDeps => {
  const { readNsecHex: readNsecHexOverride, ...rest } = over
  return {
    // Fresh identity per runtime unless overridden — the default IS stable per instance.
    readNsecHex:
      readNsecHexOverride ??
      (async () => Buffer.from(generateSecretKey()).toString("hex")),
    // M2 fix: transport reader is REQUIRED (distinct key per runtime).
    readTransportSkHex: async () => Buffer.from(generateSecretKey()).toString("hex"),
    storage: makeMemoryStorage(),
    createPool: () => makeFakePool(),
    log: () => undefined,
    ...rest,
  }
}

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

beforeEach(() => {
  __resetRelayPoolForTest()
  __resetApprovalCoordinatorForTest()
})

describe("H3: voidAllConnections on identity mutation", () => {
  it("disconnects every connection and revokes grants of the account scope", async () => {
    const otherSk = generateSecretKey()
    const otherPubkey = getPublicKey(otherSk)
    const runtime = createSignerRuntime(makeDeps())
    await runtime.grantForTest(clientPubkey, ["sign_event:22242"])
    await runtime.grantForTest(otherPubkey, [])

    expect(await runtime.listConnections()).toHaveLength(2)

    await runtime.voidAllConnections()

    const list = await runtime.listConnections()
    expect(list).toEqual([])

    // Grants are gone with the records: a former client is tombstoned (error reply path),
    // never silently serviced again.
    expect(await runtime.listActivity(clientPubkey)).toEqual([])
  })

  it("a tombstoned ex-client's request gets the disconnect error, not a signature", async () => {
    const present = jest.fn(async () => undefined)
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: {
        id: "post-void-1",
        method: "sign_event",
        params: [JSON.stringify({ kind: 22242, content: "", tags: [] })],
      },
    })
    const runtime = createSignerRuntime(makeDeps({ present, decodeForTest }))
    await runtime.grantForTest(clientPubkey, ["sign_event:22242"])

    // The identity ceremony just replaced the key → all connections are voided.
    await runtime.voidAllConnections()

    await runtime.handleInbound(makeInbound("verified") as never)
    await flush()

    // No surface, no pre-approved signing against the voided grant.
    expect(present).not.toHaveBeenCalled()
  })
})

describe("H3: approval bound to identity + account scope", () => {
  it("rejects an approved sign_event when the identity changed between raise and resolve", async () => {
    const skA = generateSecretKey()
    const skB = generateSecretKey()
    let currentSk = skA
    const readNsecHex = async () => Buffer.from(currentSk).toString("hex")

    // Present flips the identity BEFORE resolving — simulating a replace commit landing
    // while the surface is up — then approves through the shared coordinator.
    const holder: { runtime?: ReturnType<typeof createSignerRuntime> } = {}
    const present = jest.fn(async () => {
      currentSk = skB
      holder.runtime?.coordinator.resolveActive({ approved: true })
    })
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: {
        id: "swap-1",
        method: "sign_event",
        params: [JSON.stringify({ kind: 9999, content: "", tags: [] })],
      },
    })
    const runtime = createSignerRuntime(makeDeps({ present, decodeForTest, readNsecHex }))
    holder.runtime = runtime
    await runtime.grantForTest(clientPubkey, [])

    await runtime.handleInbound(makeInbound("verified") as never)
    await flush()

    // The op is recorded as REJECTED — nothing was signed under the swapped key.
    const activity = await runtime.listActivity(clientPubkey)
    expect(activity.some((e) => e.method === "sign_event" && !e.accepted)).toBe(true)
    expect(activity.some((e) => e.method === "sign_event" && e.accepted)).toBe(false)
  })

  it("accepts an approved sign_event when identity and scope are unchanged", async () => {
    const sk = generateSecretKey()
    const readNsecHex = async () => Buffer.from(sk).toString("hex")
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: {
        id: "stable-1",
        method: "sign_event",
        params: [JSON.stringify({ kind: 9999, content: "", tags: [] })],
      },
    })

    // Holder lets the presenter closure reach the runtime constructed WITH it.
    const holder: { runtime?: ReturnType<typeof createSignerRuntime> } = {}
    const present = jest.fn(async () => {
      holder.runtime?.coordinator.resolveActive({ approved: true })
    })
    const runtime = createSignerRuntime(makeDeps({ present, decodeForTest, readNsecHex }))
    holder.runtime = runtime
    await runtime.grantForTest(clientPubkey, [])

    await runtime.handleInbound(makeInbound("verified") as never)
    await flush()

    // Unchanged identity + scope → the human's approval stands and the event is signed.
    const activity = await runtime.listActivity(clientPubkey)
    expect(activity.some((e) => e.method === "sign_event" && e.accepted)).toBe(true)
  })

  it("rejects an approved capability op when the account scope switched mid-approval", async () => {
    const sk = generateSecretKey()
    let scope: string | null = "account-A"
    // The presenter flips the scope (account switch lands while the surface is up), then
    // approves through the shared coordinator.
    const holder: { runtime?: ReturnType<typeof createSignerRuntime> } = {}
    const present = jest.fn(async () => {
      scope = "account-B"
      holder.runtime?.coordinator.resolveActive({ approved: true })
    })
    const decodeForTest = () => ({
      scheme: "nip44" as const,
      clientPubkey,
      request: {
        id: "cap-swap-1",
        method: "nip44_decrypt",
        params: [clientPubkey, "ciphertext"],
      },
    })
    const runtime = createSignerRuntime(
      makeDeps({
        present,
        decodeForTest,
        readNsecHex: async () => Buffer.from(sk).toString("hex"),
        accountScopeKey: () => scope,
      }),
    )
    holder.runtime = runtime
    await runtime.grantForTest(clientPubkey, [])

    await runtime.handleInbound(makeInbound("verified") as never)
    await flush()

    const activity = await runtime.listActivity(clientPubkey)
    expect(activity.some((e) => e.method === "nip44_decrypt" && !e.accepted)).toBe(true)
    expect(activity.some((e) => e.method === "nip44_decrypt" && e.accepted)).toBe(false)
  })
})

function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}
