/**
 * Shared npub-push runtime (Story 2.3 / AD-12 / AD-17 / A7).
 *
 * Constructs the ONE process-wide persistent outbox (Story 2.1) + drain (Story 2.2) + push
 * adapter (Story 2.3), so create AND import share a SINGLE persistent slot — a re-import
 * supersedes a prior create's npub (single-slot supersede-by-seq), exactly as AD-12 requires.
 * Mirrors the ApprovalCoordinator singleton pattern (`getApprovalCoordinator`).
 *
 * v1 endpoint status (A7): the blink-lnurl-server write endpoint is btcpay-blink-owned and may
 * land AFTER v1. Until it exists, the drain's transport ports fail (endpoint absent) and the
 * drain re-queues idempotently with backoff — NEVER surfacing an error, NEVER blocking. The
 * outbox durably holds the pending npub across restarts so the drain completes the push once the
 * endpoint (and the frozen joint-contract wire-format, §11-5) lands. The challenge-acquisition /
 * PoP wire-format is deliberately NOT frozen here — it is injected behind the drain's ports.
 *
 * AD-1: core is UI-free.
 */
import { loadJson, saveJson } from "@app/utils/storage"

import { scopedStorageKey } from "./account-scope"
import { createNpubPush, type NpubPush } from "./npub-push"
import { createOutboxDrain } from "./outbox-drain"
import {
  createPersistentNpubOutbox,
  type OutboxStorage,
  type PersistentNpubOutbox,
} from "./outbox"

/**
 * The endpoint is not yet built (A7). This is the honest v1 steady state: attempting to obtain
 * a challenge fails, so the drain treats the push as an endpoint-absent transport failure and
 * re-queues with backoff. When btcpay-blink lands the endpoint + the joint-contract
 * wire-format, these ports are replaced with the real challenge/sign/push implementations
 * (no consumer change).
 */
const endpointNotYetAvailable = (): Promise<never> =>
  Promise.reject(
    new Error(
      "npub write endpoint not yet available (btcpay-blink-owned; may land post-v1)",
    ),
  )

// Account-scoped outbox (2026-08-20): the outbox slot is per-account (each account's identity
// pushes its OWN npub; a global single-slot would let one account's identity supersede
// another's). The resolver is wired by the NostrRuntimeProvider; null scope = inert.
let accountScopeResolver: (() => string | null) | null = null

/** Wire the active-account scope resolver (called once by the runtime provider). */
export const setNpubPushScopeResolver = (resolver: () => string | null): void => {
  accountScopeResolver = resolver
}

const scopedOutboxStorage: OutboxStorage = {
  loadJson: (key) => {
    const scoped = scopedStorageKey(key, accountScopeResolver?.() ?? null)
    return scoped ? loadJson(scoped) : Promise.resolve(null)
  },
  saveJson: async (key, value) => {
    const scoped = scopedStorageKey(key, accountScopeResolver?.() ?? null)
    if (scoped) await saveJson(scoped, value)
  },
}

let outboxSingleton: PersistentNpubOutbox | null = null
let pushSingleton: NpubPush | null = null

const buildRuntime = (): { outbox: PersistentNpubOutbox; push: NpubPush } => {
  const outbox = createPersistentNpubOutbox(scopedOutboxStorage)
  const drain = createOutboxDrain({
    outbox,
    // Endpoint-absent v1 ports (A7): getChallenge rejects → drain re-queues gracefully. The
    // sign/push ports are wired for when the endpoint lands; signing goes through the seam
    // then (AD-2), never reading the nsec here.
    getChallenge: endpointNotYetAvailable,
    signChallenge: endpointNotYetAvailable,
    push: endpointNotYetAvailable,
  })
  const push = createNpubPush({ outbox, drain })
  return { outbox, push }
}

/** The ONE process-wide npub push adapter (shared persistent slot for create + import). */
export const getNpubPush = (): NpubPush => {
  if (!pushSingleton) {
    const runtime = buildRuntime()
    outboxSingleton = runtime.outbox
    pushSingleton = runtime.push
  }
  return pushSingleton
}

/** The shared persistent outbox (exposed for inspection/wiring; same instance as getNpubPush). */
export const getNpubOutbox = (): PersistentNpubOutbox => {
  if (!outboxSingleton) getNpubPush()
  return outboxSingleton as PersistentNpubOutbox
}

/** Test-only: drop the singletons so each test starts clean. */
export const __resetNpubPushRuntimeForTest = (): void => {
  outboxSingleton = null
  pushSingleton = null
}
