/**
 * Story 3.1 — Single relay pool with bounded waits (AD-11 / FR-16 / NFR-6/7).
 *
 * Task 1: exactly ONE RelayPool (nostr-tools SimplePool) owns all connections;
 * per-connection relay sets come from the nostrconnect:// URI (not a global list);
 * reconnect uses capped exponential backoff — never an unbounded hot loop.
 *
 * Task 2: every network stage is bounded via withBoundedStage reading config.ts
 * timeout constants; no bare unbounded await; a stage timeout is representable and finite.
 *
 * These are framework-agnostic (transport/core, AD-1) so they run in the node harness
 * with a fake SimplePool injected — no relay/network I/O.
 */
import {
  STAGE_TIMEOUT_MS,
  OUTER_CONNECT_TIMEOUT_MS,
  SLOW_CONNECTION_HINT_MS,
  withBoundedStage,
} from "../../app/nostr/config"
import {
  getRelayPool,
  __resetRelayPoolForTest,
  parseRelaySetFromUri,
  computeBackoffDelays,
} from "../../app/nostr/transport/relay-pool"

/** A minimal fake standing in for nostr-tools SimplePool (the narrow surface we use). */
const makeFakePool = () => ({
  subscribe: jest.fn(() => ({ close: jest.fn() })),
  publish: jest.fn(() => [Promise.resolve("ok")]),
  ensureRelay: jest.fn(() => Promise.resolve({})),
  close: jest.fn(),
  destroy: jest.fn(),
})

describe("single RelayPool ownership (AD-11)", () => {
  afterEach(() => __resetRelayPoolForTest())

  it("returns exactly ONE pool instance per runtime (singleton)", () => {
    const factory = jest.fn(makeFakePool)
    const a = getRelayPool({ createPool: factory })
    const b = getRelayPool({ createPool: factory })
    expect(a).toBe(b)
    expect(factory).toHaveBeenCalledTimes(1) // second call short-circuits to the singleton
  })

  it("routes subscribe/publish to the single underlying SimplePool", () => {
    const fake = makeFakePool()
    const pool = getRelayPool({ createPool: () => fake })
    pool.subscribe(["wss://a"], { kinds: [24133] }, { onevent: jest.fn() })
    pool.publish(["wss://a"], { id: "x" } as never)
    expect(fake.subscribe).toHaveBeenCalledTimes(1)
    expect(fake.publish).toHaveBeenCalledTimes(1)
  })
})

describe("per-connection relay set from the nostrconnect:// URI (AD-11)", () => {
  it("parses exactly the relay= set from the URI (not a hardcoded global list)", () => {
    const uri =
      "nostrconnect://cafe00?relay=wss%3A%2F%2Frelay.one&relay=wss%3A%2F%2Frelay.two&secret=s"
    expect(parseRelaySetFromUri(uri)).toEqual(["wss://relay.one", "wss://relay.two"])
  })

  it("subscribes on exactly the URI's relay set", () => {
    __resetRelayPoolForTest()
    const fake = makeFakePool()
    const pool = getRelayPool({ createPool: () => fake })
    const relays = parseRelaySetFromUri(
      "nostrconnect://c?relay=wss%3A%2F%2Fonly.example&secret=s",
    )
    pool.subscribe(relays, { kinds: [24133] }, { onevent: jest.fn() })
    expect(fake.subscribe).toHaveBeenCalledWith(
      ["wss://only.example"],
      expect.anything(),
      expect.anything(),
    )
    __resetRelayPoolForTest()
  })

  it("returns an empty relay set when the URI carries none", () => {
    expect(parseRelaySetFromUri("nostrconnect://c?secret=s")).toEqual([])
  })
})

describe("capped exponential backoff reconnect (AD-11)", () => {
  it("doubles from a base up to a capped ceiling — never unbounded, never a hot loop", () => {
    const delays = computeBackoffDelays({ baseMs: 500, ceilingMs: 8000, attempts: 8 })
    // strictly increasing until the cap, then clamped to the ceiling
    expect(delays[0]).toBe(500)
    expect(delays[1]).toBe(1000)
    expect(delays[2]).toBe(2000)
    delays.forEach((delay, i) => {
      if (i > 0) expect(delay).toBeGreaterThanOrEqual(delays[i - 1])
      expect(delay).toBeLessThanOrEqual(8000)
    })
    expect(delays[delays.length - 1]).toBe(8000) // reached & clamped to the ceiling
  })

  it("never yields a zero/negative delay (no immediate hot loop)", () => {
    const delays = computeBackoffDelays({ baseMs: 500, ceilingMs: 8000, attempts: 8 })
    for (const d of delays) expect(d).toBeGreaterThan(0)
  })
})

describe("withBoundedStage — every network await is bounded (AD-11 / NFR-7)", () => {
  it("resolves the wrapped fn's value when it completes before the bound", async () => {
    const value = await withBoundedStage(STAGE_TIMEOUT_MS, async () => "done")
    expect(value).toBe("done")
  })

  it("rejects with a timeout SignerError when the stage exceeds its bound", async () => {
    jest.useFakeTimers()
    const pending = withBoundedStage(50, () => new Promise(() => {})).catch(
      (err: unknown) => err,
    )
    await jest.advanceTimersByTimeAsync(60)
    expect(await pending).toMatchObject({ code: "timeout" })
    jest.useRealTimers()
  })

  it("aborts promptly when the injected AbortSignal fires (bounded, cancellable)", async () => {
    const ac = new AbortController()
    const pending = withBoundedStage(
      STAGE_TIMEOUT_MS,
      () => new Promise(() => {}),
      ac.signal,
    )
    ac.abort()
    await expect(pending).rejects.toMatchObject({ code: "aborted" })
  })

  it("timeout constants keep the no-infinite-spinner ordering (slow < stage <= outer)", () => {
    expect(SLOW_CONNECTION_HINT_MS).toBeLessThan(STAGE_TIMEOUT_MS)
    expect(STAGE_TIMEOUT_MS).toBeLessThanOrEqual(OUTER_CONNECT_TIMEOUT_MS)
  })
})
