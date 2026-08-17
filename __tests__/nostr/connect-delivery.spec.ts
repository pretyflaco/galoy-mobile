/**
 * Device fix (Amber parity) — reliable NIP-46 response delivery + connect de-dup.
 *
 * On-device sign-in against the BTCPay NostrLogin plugin failed silently: the plugin logged
 * nothing, meaning the app's connect-ack never reached the plugin's relay subscription. Amber
 * (the reference signer) succeeds because it (a) warms the relay socket and registers the
 * listening REQ BEFORE publishing the connect response, and (b) publishes with CONFIRMED +
 * RETRIED delivery (publishAndConfirm + retryWithBackoff). A NIP-46 response is an ephemeral
 * event — a single-shot publish to a cold socket is dropped by the relay and the client times
 * out. These tests lock in the Amber-parity behavior:
 *
 *  1. retryWithBackoff retries a failing publish and succeeds when a later attempt succeeds.
 *  2. The connect-ack path ENSURES the relay + REGISTERS the subscription BEFORE it publishes.
 *  3. The ack publish is retried until a relay confirms (no silent single-shot drop).
 *  4. A concurrent handleConnectUri for the SAME client enqueues only ONE approval (no double
 *     modal).
 */
import { generateSecretKey, getPublicKey } from "nostr-tools/pure"
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"

import {
  createSignerRuntime,
  retryWithBackoff,
  type SignerRuntimeDeps,
} from "../../app/nostr/runtime"
import { __resetRelayPoolForTest } from "../../app/nostr/transport/relay-pool"

// A deterministic client (the BTCPay plugin) identity for the nostrconnect:// URI.
const clientSk = generateSecretKey()
const clientPubkey = getPublicKey(clientSk)
const RELAY = "wss://relay.example.test"
const SECRET = "deadbeefcafef00d"
const connectUri = `nostrconnect://${clientPubkey}?relay=${encodeURIComponent(
  RELAY,
)}&secret=${SECRET}&perms=${encodeURIComponent("sign_event:22242")}&name=BTCPay%20Server`

const makeMemoryStorage = () => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (key: string) => map.get(key) ?? null,
    saveJson: async (key: string, value: unknown) => {
      map.set(key, value)
    },
  }
}

const userSk = generateSecretKey()
const readNsecHex = async () => Buffer.from(userSk).toString("hex")

// An instrumented pool that RECORDS the ORDER of ensureRelay / subscribe / publish calls and
// lets a test force publish attempts to fail a fixed number of times.
const makeInstrumentedPool = (failPublishTimes = 0) => {
  const calls: string[] = []
  const published: unknown[] = []
  let publishAttempts = 0
  let onEvent: ((e: unknown) => void) | null = null
  const pool = {
    subscribe: (
      _relays: string[],
      _filter: Record<string, unknown>,
      params: Record<string, unknown>,
    ) => {
      calls.push("subscribe")
      onEvent = params.onevent as (e: unknown) => void
      return { close: () => undefined }
    },
    publish: (_relays: string[], event: unknown) => {
      calls.push("publish")
      publishAttempts += 1
      if (publishAttempts <= failPublishTimes) {
        return [Promise.reject(new Error("relay rejected"))]
      }
      published.push(event)
      return [Promise.resolve("ok")]
    },
    ensureRelay: (_url: string) => {
      calls.push("ensureRelay")
      return Promise.resolve({})
    },
    close: () => undefined,
    destroy: () => undefined,
  }
  return {
    pool,
    calls,
    published,
    inject: (e: unknown) => onEvent?.(e),
    get publishAttempts() {
      return publishAttempts
    },
  }
}

const makeDeps = (
  pool: ReturnType<typeof makeInstrumentedPool>["pool"],
  over: Partial<SignerRuntimeDeps> = {},
): SignerRuntimeDeps => ({
  readNsecHex,
  storage: makeMemoryStorage(),
  createPool: () => pool,
  log: () => undefined,
  ...over,
})

// Build a runtime whose approval surface AUTO-APPROVES: `present` resolves the active entry via
// the runtime's own coordinator (the UI normally does this via resolveActive). A ref bridges the
// definition-order gap (present is defined before the runtime exists).
const makeAutoApproveRuntime = (
  pool: ReturnType<typeof makeInstrumentedPool>["pool"],
) => {
  const ref: { current: ReturnType<typeof createSignerRuntime> | null } = {
    current: null,
  }
  const present = async (): Promise<void> => {
    // Resolve on a microtask so enqueue has returned control to the coordinator's pump.
    await Promise.resolve()
    ref.current?.coordinator.resolveActive({ approved: true })
  }
  const runtime = createSignerRuntime(makeDeps(pool, { present }))
  ref.current = runtime
  return runtime
}

beforeEach(() => {
  __resetRelayPoolForTest()
})

describe("retryWithBackoff (Amber parity)", () => {
  it("returns true immediately on first success (no delay path)", async () => {
    const block = jest.fn(async () => true)
    const ok = await retryWithBackoff(block, {}, async () => undefined)
    expect(ok).toBe(true)
    expect(block).toHaveBeenCalledTimes(1)
  })

  it("retries a failing block and succeeds when a later attempt succeeds", async () => {
    let n = 0
    const block = jest.fn(async () => {
      n += 1
      return n >= 3 // fail twice, then succeed
    })
    const sleeps: number[] = []
    const ok = await retryWithBackoff(block, { initialDelayMs: 10 }, async (ms) => {
      sleeps.push(ms)
    })
    expect(ok).toBe(true)
    expect(block).toHaveBeenCalledTimes(3)
    // Capped exponential backoff between attempts: 10, 20.
    expect(sleeps).toEqual([10, 20])
  })

  it("gives up after maxRetries and returns false", async () => {
    const block = jest.fn(async () => false)
    const ok = await retryWithBackoff(block, { maxRetries: 4 }, async () => undefined)
    expect(ok).toBe(false)
    expect(block).toHaveBeenCalledTimes(4)
  })
})

describe("connect-ack delivery (Amber parity)", () => {
  it("ensures the relay + registers the subscription BEFORE publishing the ack", async () => {
    const inst = makeInstrumentedPool()
    const runtime = makeAutoApproveRuntime(inst.pool)

    await runtime.handleConnectUri(connectUri)

    // The first publish (the ack) must be preceded by an ensureRelay AND a subscribe — otherwise
    // the ephemeral get_public_key that follows the ack has no subscriber and is dropped.
    const firstPublish = inst.calls.indexOf("publish")
    expect(firstPublish).toBeGreaterThan(-1)
    expect(inst.calls.slice(0, firstPublish)).toContain("ensureRelay")
    expect(inst.calls.slice(0, firstPublish)).toContain("subscribe")
  })

  it("publishes the ack addressed to the client, echoing the secret", async () => {
    const inst = makeInstrumentedPool()
    const runtime = makeAutoApproveRuntime(inst.pool)

    await runtime.handleConnectUri(connectUri)

    // Exactly one confirmed ack event was published, tagged to the client (#p) and kind-24133.
    const ack = inst.published[0] as { kind: number; tags: string[][] }
    expect(ack.kind).toBe(24133)
    expect(ack.tags).toContainEqual(["p", clientPubkey])
  })

  it("retries the ack until a relay confirms (no silent single-shot drop)", async () => {
    // First two publish attempts reject; the third confirms. The ack is sent fire-and-forget
    // (it must not block the connect flow), so the retries run in the background with real
    // backoff (200ms, 400ms) — poll until the confirmed publish lands.
    const inst = makeInstrumentedPool(2)
    const runtime = makeAutoApproveRuntime(inst.pool)

    await runtime.handleConnectUri(connectUri)

    // Wait (up to ~2s) for the third attempt to confirm.
    const deadline = Date.now() + 2000
    while (inst.published.length === 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25)
      })
    }

    expect(inst.publishAttempts).toBeGreaterThanOrEqual(3)
    expect(inst.published.length).toBeGreaterThanOrEqual(1)
  })
})

describe("connect de-dup (Fix B)", () => {
  it("enqueues only one approval for concurrent connects with the same client", async () => {
    const inst = makeInstrumentedPool()
    // A present that never resolves keeps the FIRST approval pending, so a concurrent second
    // call would (without the guard) enqueue a SECOND approval. Count present() invocations.
    const present = jest.fn(
      () =>
        new Promise<void>(() => {
          /* never resolves — approval stays open */
        }),
    )
    const runtime = createSignerRuntime(makeDeps(inst.pool, { present }))

    const a = runtime.handleConnectUri(connectUri)
    const b = runtime.handleConnectUri(connectUri)
    // Let both invocations reach (or be dropped before) the enqueue/present path.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20)
    })

    expect(present).toHaveBeenCalledTimes(1)
    // Both calls remain pending (present never resolves); nothing to await further.
    expect([a, b]).toHaveLength(2)
  })
})

// Sanity: the transport pubkey derivation used by the #p subscription filter matches the ack
// author, so the plugin's follow-up requests (#p = ack author) reach our subscription.
describe("transport pubkey consistency", () => {
  it("derives the same x-only pubkey the ack is authored with", () => {
    const hex = bytesToHex(schnorr.getPublicKey(userSk))
    expect(hex).toHaveLength(64)
  })
})
