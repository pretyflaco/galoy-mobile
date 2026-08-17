/**
 * Single relay pool (Story 3.1 / AD-11).
 *
 * Exactly ONE RelayPool (nostr-tools `SimplePool`) owns ALL relay connections for the
 * signer runtime — the single transport substrate for every NIP-46 kind-24133 message.
 * Per-connection relay sets are taken from the `nostrconnect://` URI (never a hardcoded
 * global list). Reconnect uses capped exponential backoff — a bounded ceiling, never an
 * unbounded/immediate hot loop.
 *
 * AD-1: transport carries NO React/UI imports; it exposes a narrow pool handle to the
 * pipeline. The concrete `SimplePool` is injected (`createPool`) so this module is
 * unit-testable without opening a socket.
 *
 * NFR-6 (relay-timeline charging): the signer tolerates public-relay flakiness/latency via
 * bounded stages (config.withBoundedStage) + this capped-backoff reconnect. An NFR-1 latency
 * miss attributable to public-relay conditions is a btcpay-blink RELAY-TIMELINE finding, NOT
 * a v1 signer defect. See the reconnect scheduler below where backoff is applied.
 */
import { SimplePool } from "nostr-tools/pool"

/** The narrow handle the pipeline consumes — the only surface we depend on from SimplePool. */
export interface RelayPool {
  subscribe(
    relays: string[],
    filter: Record<string, unknown>,
    params: Record<string, unknown>,
  ): { close: (reason?: string) => void }
  publish(relays: string[], event: unknown): Promise<string>[]
  /**
   * Open (or reuse) a connection to a single relay, resolving once the socket is connected.
   * Mirrors Amber's `client.connect()` before a connect-response publish: a NIP-46 response
   * (ack / get_public_key / sign_event) is an EPHEMERAL event — if it is published to a relay
   * whose socket is not yet open, the relay drops it and the client times out. Warming the
   * socket first (and registering the listening REQ before the ack) makes single-shot delivery
   * reliable on public relays (nos.lol / relay.primal.net).
   */
  ensureRelay(url: string, params?: { connectionTimeout?: number }): Promise<unknown>
  close(relays: string[]): void
  destroy(): void
}

interface GetRelayPoolOptions {
  /** Injectable factory (defaults to a real nostr-tools SimplePool). Enables unit tests. */
  createPool?: () => RelayPool
}

const defaultCreatePool = (): RelayPool =>
  new SimplePool({ enableReconnect: true }) as unknown as RelayPool

let singleton: RelayPool | null = null

/**
 * Return the ONE process-wide relay pool, creating it on first call. A second call
 * short-circuits to the existing singleton — a second `SimplePool` is never instantiated
 * (AD-11: one pool owns all connections).
 */
export const getRelayPool = (options: GetRelayPoolOptions = {}): RelayPool => {
  if (singleton) return singleton
  const create = options.createPool ?? defaultCreatePool
  singleton = create()
  return singleton
}

/** Test-only: drop the singleton so each test starts from a clean pool. */
export const __resetRelayPoolForTest = (): void => {
  singleton = null
}

/**
 * Extract the per-connection relay set from a `nostrconnect://` URI. Returns exactly the
 * `relay=` values (in order, deduplicated by the caller's URI), or an empty array if the URI
 * carries none. Never falls back to a hardcoded global relay list (AD-11).
 */
export const parseRelaySetFromUri = (uri: string): string[] => {
  const queryStart = uri.indexOf("?")
  if (queryStart === -1) return []
  const params = new URLSearchParams(uri.slice(queryStart + 1))
  return params.getAll("relay")
}

interface BackoffOptions {
  baseMs: number
  ceilingMs: number
  attempts: number
}

/**
 * Capped exponential backoff schedule for reconnect (AD-11): base, base*2, base*4, … each
 * clamped to `ceilingMs`. Bounded ceiling, strictly positive delays — never an immediate
 * (zero-delay) hot loop, never unbounded growth.
 *
 * NFR-6: this scheduler is where transient public-relay drops are absorbed. Repeated drops
 * back off toward the ceiling rather than hammering the relay; a resulting latency miss is a
 * relay-timeline finding, not a signer defect.
 */
export const computeBackoffDelays = (options: BackoffOptions): number[] => {
  const { baseMs, ceilingMs, attempts } = options
  return Array.from({ length: attempts }, (_unused, attempt) =>
    Math.min(baseMs * Math.pow(2, attempt), ceilingMs),
  )
}
