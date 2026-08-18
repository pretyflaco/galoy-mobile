/**
 * Signer runtime assembly (Story A1 / AD-1 / AD-11 / AD-9).
 *
 * The ONE place that constructs the concrete signer ports and holds them together as a single
 * handle. Every Epic 1–4 module is built behind injected ports; this module wires the real
 * implementations into a working runtime:
 *
 *   relay pool (Story 3.1, AD-11)  →  ONE SimplePool owns all connections
 *   connection store (Story 3.3)   →  the sole grant-truth, persisted
 *   signer seam (Story 1.3, AD-2)  →  LocalNsecSigner, the sole nsec path
 *   approval coordinator (3.4)     →  the SINGLE owner of all approval surfacing
 *   inbound pipeline (3.2, AD-16)  →  verify → decode → dispatch, verify-first
 *   connect-flow (3.3, AD-8)       →  nostrconnect:// handshake
 *   sign / encrypt flows (3.5/3.6) →  approval-gated method execution
 *
 * The connect-time grant (v1: only sign_event:22242) is enforced by the coordinator's
 * `isCoveredByGrant` (grantCoverageFromPolicy) so a granted sign-in passes through WITHOUT a
 * surface; every other approval-gated method raises its own fresh surface.
 *
 * AD-1: this module carries NO React/RN/UI imports — the assembly is framework-agnostic and
 * unit-testable without a socket or the keychain. Native concerns (keychain reads, MMKV
 * storage) are injected as ports; the RN provider binds them.
 *
 * Keychain services (AD-4): the IDENTITY nsec drives the NostrSigner seam; the DEVICE-LOCAL
 * transport secret drives NIP-46 transport decode/encode. They are distinct keys.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { verifyEvent, type Event } from "nostr-tools/pure"
import * as nip19 from "nostr-tools/nip19"

import {
  initApprovalCoordinator,
  type ApprovalCoordinator,
  type ApprovalEntry,
} from "./approval/coordinator"
import { grantCoverageFromPolicy } from "./approval/grant-adapter"
import {
  buildCapabilityPreview,
  buildSignEventPreview,
  formatSignEventPanel,
} from "./approval/request-preview"
import {
  createConnectionStore,
  GRANTABLE_SCOPE,
  type ConnectionRecord,
  type ConnectionStorage,
  type ConnectionStore,
} from "./core/connection-store"
import { createLocalNsecSigner } from "./core/local-nsec-signer"
import { NIP98_KIND } from "./core/policy-check"
import { normalizeHost } from "./core/url-origin"
import { signerLogFields } from "./core/redact"
import { createRequestLedger } from "./core/request-ledger"
import {
  createActivityLog,
  type ActivityEntry,
  type ActivityStats,
} from "./core/activity-log"
import {
  createDuplicatePromptStore,
  type DuplicatePromptStore,
} from "./core/duplicate-prompt"
import {
  createAwaitingFollowupStore,
  type AwaitingFollowupStore,
} from "./core/awaiting-followup"
import type { ConnectionRecordLike, SignerGateDeps } from "./signer-gate"
import {
  createConnectFlow,
  parseNostrConnectUri,
  type ConnectFlow,
} from "./transport/connect-flow"
import { createRequestDispatcher } from "./transport/dispatcher"
import {
  createEncryptDecryptFlow,
  type CapabilityMethod,
} from "./transport/encrypt-decrypt"
import {
  decodeRequest,
  encodeResponse,
  NIP46_KIND,
  type DecodedRequest,
  type Nip46Response,
} from "./transport/nip46-codec"
import { createInboundPipeline, type InboundPipeline } from "./transport/pipeline"
import { getRelayPool, type RelayPool } from "./transport/relay-pool"
import { createSignEventFlow } from "./transport/sign-event"

/** The native + test-injectable ports the runtime is built from (AD-1). */
export interface SignerRuntimeDeps {
  /** Read the IDENTITY nsec as lowercase hex (keystore-backed; drives the NostrSigner seam). */
  readNsecHex: (signal?: AbortSignal) => Promise<string>
  /** Read the DEVICE-LOCAL transport secret as hex (drives NIP-46 decode/encode, AD-4). */
  readTransportSkHex?: () => Promise<string>
  /** Persistence port for the ConnectionStore / ledger (defaults injected by the RN provider). */
  storage?: ConnectionStorage
  /** Injectable relay-pool factory (defaults to the real SimplePool via getRelayPool). */
  createPool?: () => RelayPool
  /** Metadata-only log sink (never plaintext/keys). */
  log?: (fields: Record<string, string | number>) => void
  /** The RN approval surface presenter; resolves via coordinator.resolveActive when UI binds. */
  present?: (entry: ApprovalEntry) => Promise<void>

  // -- test seams (never wired in production) --
  /** Test-only: replace the decode stage so inbound wiring can be exercised without crypto. */
  decodeForTest?: (event: Event) => DecodedRequest
}

export interface SignerRuntime {
  /** The single inbound entry: every kind-24133 event flows through here (pipeline). */
  handleInbound(event: Event): Promise<void>
  /** The nostrconnect:// handshake entry (forwarded raw from the deep-link/QR layer). */
  handleConnectUri(rawUri: string): Promise<void>
  /** The SINGLE approval coordinator the UI presents from (AD-9). */
  coordinator: ApprovalCoordinator
  /** The flag-boundary control surface (Story 1.4). */
  gateDeps: SignerGateDeps
  /** List the current connection records (management UI). */
  listConnections(): Promise<ConnectionRecord[]>
  /**
   * Per-relay delivery health: how many of our published NIP-46 events each relay has ACKed
   * (accepted), keyed by relay URL. Drives the Amber-style relay badges. Observational only.
   */
  relayHealth(): Record<string, number>
  /** Atomically disconnect a client (delete record + void grant + tombstone) and re-sync. */
  disconnect(clientPubkey: string): Promise<void>
  /** The re-login Replace/Keep-both/Cancel prompt store (rendered by the ApprovalSurfaceHost). */
  duplicatePrompt: DuplicatePromptStore
  /** The sign-in "waiting for login request" store (rendered by the ApprovalSurfaceHost). */
  awaitingFollowup: AwaitingFollowupStore
  /** Metadata-only activity history for a client (newest first) — the "Show activity" screen. */
  listActivity(clientPubkey: string): Promise<ActivityEntry[]>
  /** Aggregate accept/reject stats for a client (activity screen stats card). */
  activityStats(clientPubkey: string): Promise<ActivityStats>
  /** Subscribe to activity changes so a live screen re-reads on each new entry. */
  subscribeActivity(listener: () => void): () => void
  /** Test-only: grant a scope to a client (simulates a completed connect). */
  grantForTest(clientPubkey: string, grantedScopes: string[]): Promise<void>
}

/** The v1 approval-gated capability methods (Story 3.6). */
const CAPABILITY_METHODS = new Set<string>([
  "nip04_encrypt",
  "nip04_decrypt",
  "nip44_encrypt",
  "nip44_decrypt",
])

const toRecordLike = (
  records: { clientPubkey: string; relays: string[] }[],
): ConnectionRecordLike[] =>
  records.map((r) => ({ clientPubkey: r.clientPubkey, relays: r.relays }))

/**
 * Origin-bind key for a sign_event approval entry: for a kind-27235 (NIP-98) event, the
 * normalized host of its first `["u", <url>]` tag; null/undefined otherwise. Defensive — a
 * malformed event or absent tag yields null, which the policy treats as a mismatch → prompt.
 */
const uHostForSign = (event: {
  kind?: number
  tags?: string[][]
}): string | null | undefined => {
  if (event.kind !== NIP98_KIND) return undefined
  const uTag = event.tags?.find((t) => t[0] === "u")?.[1] ?? null
  return uTag ? normalizeHost(uTag) : null
}

/**
 * Run a fire-and-forget async side effect (activation / snapshot refresh) from a synchronous
 * gate/entry-point call. Errors are swallowed to a metadata-only log — a background refresh
 * failure must never throw into the wallet host (NFR-9). Avoids the banned `void promise` form.
 */
const fireAndForget = (
  work: () => Promise<void>,
  onError: (fields: Record<string, string | number>) => void,
): void => {
  work().catch(() => onError({ dropped: "background-task-failed" }))
}

/**
 * Retry an async boolean operation with capped exponential backoff, mirroring Amber's
 * `retryWithBackoff` (BunkerRequestUtils.kt): 5 attempts, 200ms → 3.2s ceiling. Returns true on
 * the first success, false if every attempt fails. A NIP-46 response is a single-shot ephemeral
 * event; without this a transient public-relay drop silently loses the reply and the client
 * (BTCPay plugin) times out with no logged reason.
 */
export const retryWithBackoff = async (
  block: () => Promise<boolean>,
  options: { maxRetries?: number; initialDelayMs?: number; maxDelayMs?: number } = {},
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms)
    }),
): Promise<boolean> => {
  const maxRetries = options.maxRetries ?? 5
  const initialDelayMs = options.initialDelayMs ?? 200
  const maxDelayMs = options.maxDelayMs ?? 3_200
  let delay = initialDelayMs
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (await block()) return true
    if (attempt < maxRetries - 1) {
      await sleep(delay)
      delay = Math.min(delay * 2, maxDelayMs)
    }
  }
  return false
}

export const createSignerRuntime = (deps: SignerRuntimeDeps): SignerRuntime => {
  const log = deps.log ?? ((): void => undefined)
  const store: ConnectionStore = createConnectionStore(deps.storage)
  const signer = createLocalNsecSigner({ readNsecHex: deps.readNsecHex })
  const ledger = createRequestLedger(deps.storage)
  const activityLog = createActivityLog(deps.storage)
  const duplicatePrompt = createDuplicatePromptStore()
  const awaitingFollowup = createAwaitingFollowupStore()
  const pool = getRelayPool({ createPool: deps.createPool })

  // Sliding-window auto-clear for the sign-in waiting overlay. A slow app (e.g. vezir over 5
  // relays with clock-offset learning + republish) sequences connect → get_public_key →
  // sign_event(27235) with real gaps between steps; a single fixed timeout would drop the spinner
  // mid-handshake. Instead we treat the wait as an IDLE window that RESETS on each inbound request
  // from the awaited client (bumpAwaiting, called from recordActivity): as long as the flow is
  // still progressing the overlay stays up, and only a genuine stall (no step within the idle
  // window) falls back to the Activity screen. An absolute cap bounds a pathological loop.
  const FOLLOWUP_IDLE_TIMEOUT_MS = 90_000
  const FOLLOWUP_ABSOLUTE_CAP_MS = 180_000
  const followupTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const followupDeadlines = new Map<string, number>()
  const stopAwaiting = (clientPubkey: string): void => {
    const timer = followupTimers.get(clientPubkey)
    if (timer) {
      clearTimeout(timer)
      followupTimers.delete(clientPubkey)
    }
    followupDeadlines.delete(clientPubkey)
    awaitingFollowup.clear(clientPubkey)
  }
  // (Re)arm the idle timer for a client, clamped to the absolute cap set at startAwaiting.
  const armFollowupTimer = (clientPubkey: string): void => {
    const prior = followupTimers.get(clientPubkey)
    if (prior) clearTimeout(prior)
    const cap =
      followupDeadlines.get(clientPubkey) ?? Date.now() + FOLLOWUP_ABSOLUTE_CAP_MS
    const delay = Math.max(0, Math.min(FOLLOWUP_IDLE_TIMEOUT_MS, cap - Date.now()))
    followupTimers.set(
      clientPubkey,
      setTimeout(() => stopAwaiting(clientPubkey), delay),
    )
  }
  const startAwaiting = (state: {
    clientPubkey: string
    name?: string
    image?: string
  }): void => {
    awaitingFollowup.set(state)
    followupDeadlines.set(state.clientPubkey, Date.now() + FOLLOWUP_ABSOLUTE_CAP_MS)
    armFollowupTimer(state.clientPubkey)
  }
  // Reset the idle window when a request from the awaited client arrives (still progressing).
  const bumpAwaiting = (clientPubkey: string): void => {
    if (awaitingFollowup.current()?.clientPubkey !== clientPubkey) return
    armFollowupTimer(clientPubkey)
  }

  // Metadata-only activity recording (leak-audit safe): log the accept/reject decision for a
  // client's request. Fire-and-forget — persistence must never block or fail a signer response.
  const recordActivity = (
    clientPubkey: string,
    entry: { method: string; accepted: boolean; eventKind?: number },
  ): void => {
    // Progress signal: a request from the awaited client resets the sign-in idle window so a
    // slow-but-advancing handshake keeps the waiting overlay up instead of timing out.
    bumpAwaiting(clientPubkey)
    activityLog
      .record(clientPubkey, { ...entry, time: Date.now() })
      .catch(() => undefined)
  }

  // The device-local transport secret used to decode inbound / encode outbound (AD-4). Falls
  // back to the identity key ONLY in tests that never exercise real decode (decodeForTest).
  const readTransportSk = deps.readTransportSkHex ?? deps.readNsecHex

  // -- the ONE process-wide coordinator (AD-9): bind the real surface + connect-time grant
  //    predicate onto the singleton so ceremony `runExclusive` and this runtime SHARE it.
  const coordinator = initApprovalCoordinator({
    present: deps.present ?? (async (): Promise<void> => undefined),
    isCoveredByGrant: grantCoverageFromPolicy(store),
  })
  const raiseApproval = async (entry: ApprovalEntry): Promise<boolean> =>
    (await coordinator.enqueue(entry)).approved

  // Relays are taken per-connection from the ConnectionStore records (AD-11: never a global
  // hardcoded list). A synchronous snapshot backs the gate's sync list() + publish targets.
  let relaySnapshot: string[] = []
  let recordSnapshot: ConnectionRecordLike[] = []

  // Per-relay delivery health (Amber-parity badges). A side-map of how many of our published
  // NIP-46 events each relay ACKed (accepted). Purely observational: recorded from the OK channel
  // pool.publish already returns, WITHOUT gating delivery (publishConfirmed's control flow is the
  // hard-won reliability path and is left untouched). Surfaced to the UI via relayHealth().
  const relayAccepts = new Map<string, number>()
  const observeRelayOutcomes = (relays: string[], results: Promise<string>[]): void => {
    relays.forEach((url, i) => {
      const p = results[i]
      if (!p) return
      // Swallow rejections — a failed relay simply doesn't increment (renders as "?"/0).
      p.then(() => {
        relayAccepts.set(url, (relayAccepts.get(url) ?? 0) + 1)
      }).catch(() => undefined)
    })
  }
  const syncSnapshots = async (): Promise<void> => {
    const records = await store.list()
    recordSnapshot = toRecordLike(records)
    relaySnapshot = Array.from(new Set(records.flatMap((r) => r.relays)))
  }
  // Warm every relay socket before a single-shot publish (Amber's `client.connect()` before a
  // connect-response). ensureRelay resolves once connected; failures are swallowed (the publish
  // retry below still attempts delivery and confirms via the OK channel).
  const ensureRelays = async (relays: string[]): Promise<void> => {
    await Promise.all(
      relays.map((url) =>
        pool.ensureRelay(url, { connectionTimeout: 5000 }).catch(() => undefined),
      ),
    )
  }

  // Confirmed + retried publish (AD-10 / Amber parity). `encode` is a THUNK so each retry mints a
  // fresh event (new created_at → new id); a stale/duplicate ephemeral event may be dropped by a
  // relay that already saw it. `pool.publish` returns one Promise<string> per relay that RESOLVES
  // on the relay's OK and rejects/times out otherwise; `Promise.any` succeeds on the first OK.
  // Warms sockets first so the very first attempt lands on a connected relay.
  const publishConfirmed = async (
    relays: string[],
    encode: () => Event,
  ): Promise<boolean> => {
    if (relays.length === 0) return false
    await ensureRelays(relays)
    return retryWithBackoff(async () => {
      try {
        const results = pool.publish(relays, encode())
        observeRelayOutcomes(relays, results) // record per-relay ACKs (non-gating)
        await Promise.any(results)
        return true
      } catch {
        return false // every relay rejected/timed out this attempt
      }
    })
  }

  // Fire-and-forget wrapper for the response paths (kept non-blocking to the pipeline), but now
  // backed by confirmed+retried delivery. Logs a drop only after all retries fail.
  const publishResponse = (relays: string[], encode: () => Event): void => {
    fireAndForget(async () => {
      const ok = await publishConfirmed(relays, encode)
      if (!ok) log({ dropped: "publish-unconfirmed" })
    }, log)
  }

  // Encode a NIP-46 response in-kind (AD-10) with the device-local transport secret and publish
  // it back to the client. Used by the approval-gated flows (sign_event, nip04/nip44), which
  // otherwise compute a result the client would never receive. Confirmed + retried (Amber parity)
  // so a transient relay drop does not silently lose the reply.
  const sendResponse = async (
    response: Nip46Response,
    decoded: DecodedRequest,
  ): Promise<boolean> => {
    await primeTransportSk()
    if (transportSkCache === null) return false
    const sk = transportSkCache
    // Returns whether the response was CONFIRMED published (>=1 relay ACK) — the strongest
    // "delivered to the client" signal that exists. The waiting overlay uses this to know the
    // signed sign-in event actually left the device. publishConfirmed already retries; we await
    // it here so the caller can react to delivery (the fire-and-forget publishResponse remains
    // for paths that do not need the outcome).
    return publishConfirmed(relaySnapshot, () =>
      encodeResponse(response, {
        scheme: decoded.scheme,
        clientPubkey: decoded.clientPubkey,
        transportSk: sk,
      }),
    )
  }

  // At-most-once surfacing for approval-gated flows (fix #6). The STAGE_TIMEOUT retry re-delivers
  // the SAME request id ~10s later; without this guard the retry would raise a SECOND approval
  // surface for a request whose first surface is still open (pending) or already resolved
  // (answered). Register through the same ledger the transport dispatcher uses: `pending-duplicate`
  // → drop (the first surface still owns it); `answered` → replay the stored response WITHOUT
  // re-executing / re-surfacing. Returns true when the caller should proceed (status "new").
  const admitApprovalGated = async (decoded: DecodedRequest): Promise<boolean> => {
    const seen = await ledger.register(decoded.clientPubkey, decoded.request.id)
    if (seen.status === "pending-duplicate") return false
    if (seen.status === "answered") {
      if (seen.storedResponse !== undefined) {
        await sendResponse(JSON.parse(seen.storedResponse) as Nip46Response, decoded)
      }
      return false
    }
    return true
  }

  // -- sign_event flow (Story 3.5): approval-gated, signs through the seam only.
  const runSignEvent = async (decoded: DecodedRequest): Promise<void> => {
    if (!(await admitApprovalGated(decoded))) return
    const userNpub = await signer.getPublicKey()
    const flow = createSignEventFlow({
      signer,
      userNpub,
      now: () => Math.floor(Date.now() / 1000),
      requestApproval: (event) =>
        raiseApproval({
          id: decoded.request.id,
          kind: "request",
          clientPubkey: decoded.clientPubkey,
          method: "sign_event",
          eventKind: event.kind,
          // Origin-bind key for a NIP-98 (27235) sign: the host of the first `u` tag. The policy
          // pre-approves 27235 only when this equals the connect-time app origin. Defensive parse
          // (malformed/absent → null → prompt). Non-27235 kinds carry no u-host.
          uHost: uHostForSign(event),
          humanAction: "sign-in-and-sign",
          // Structured "what will be signed" panel (B4): the exact fields being signed.
          contentPreview: formatSignEventPanel(buildSignEventPreview(event)),
        }).then((approved) => ({ approved })),
    })
    const raw = JSON.parse(decoded.request.params[0] ?? "{}")
    const result = await flow.handle(raw)
    // Metadata-only activity: method + signed kind + accept/reject (NEVER the event content).
    recordActivity(decoded.clientPubkey, {
      method: "sign_event",
      accepted: result.ok,
      eventKind: typeof raw?.kind === "number" ? raw.kind : undefined,
    })
    // Respond in-kind: the signed event JSON on success, a spec error on rejection.
    const response: Nip46Response = result.ok
      ? { id: decoded.request.id, result: JSON.stringify(result.event) }
      : { id: decoded.request.id, error: result.error }
    // Record the answer so a later STAGE_TIMEOUT retry replays it instead of re-surfacing (fix #6).
    await ledger.recordResponse(
      decoded.clientPubkey,
      decoded.request.id,
      JSON.stringify(response),
    )
    const confirmed = await sendResponse(response, decoded)
    // Sign-in delivered: the login sign_event was approved AND its signed response was
    // confirmed-published (>=1 relay ACK). This is the moment to stop waiting — the client will
    // complete login over HTTP with no further signer involvement. On rejection or an unconfirmed
    // publish we leave the timeout to clear the wait (the client may retry / the user backed out).
    if (result.ok && confirmed) stopAwaiting(decoded.clientPubkey)
  }

  // -- encrypt/decrypt flow (Story 3.6): each op raises its OWN fresh approval.
  const runCapability = async (decoded: DecodedRequest): Promise<void> => {
    if (!(await admitApprovalGated(decoded))) return
    const flow = createEncryptDecryptFlow({
      signer,
      log,
      requestApproval: (req) =>
        raiseApproval({
          id: decoded.request.id,
          kind: "request",
          clientPubkey: decoded.clientPubkey,
          method: req.method,
          humanAction: req.method,
          // Metadata-only preview (B4): op + counterparty; NEVER the payload (leak-audit gate).
          contentPreview: buildCapabilityPreview(req.method, req.peerPubkey),
        }).then((approved) => ({ approved })),
    })
    const result = await flow.handle({
      method: decoded.request.method as CapabilityMethod,
      peerPubkey: decoded.request.params[0] ?? "",
      payload: decoded.request.params[1] ?? "",
    })
    // Metadata-only activity: op + accept/reject (NEVER the counterparty or payload).
    recordActivity(decoded.clientPubkey, {
      method: decoded.request.method,
      accepted: result.ok,
    })
    const response: Nip46Response = result.ok
      ? { id: decoded.request.id, result: result.result }
      : { id: decoded.request.id, error: result.error }
    // Record the answer so a STAGE_TIMEOUT retry replays it instead of re-surfacing (fix #6).
    await ledger.recordResponse(
      decoded.clientPubkey,
      decoded.request.id,
      JSON.stringify(response),
    )
    await sendResponse(response, decoded)
  }

  // The user's x-only pubkey as HEX (NIP-46 get_public_key wire format). The seam returns npub
  // for display; decode it to hex here — a bech32 npub is rejected by NIP-46 clients.
  const getUserPubkeyHex = async (): Promise<string> => {
    const decoded = nip19.decode(await signer.getPublicKey())
    return decoded.data as string
  }

  // -- transport dispatcher (Story 3.2): ping / get_public_key / connect + ledger + respond-in-kind.
  const dispatchTransport = async (
    decoded: DecodedRequest,
    event: Event,
    transportSk: string,
  ): Promise<void> => {
    const dispatcher = createRequestDispatcher({
      ledger,
      methodPorts: { getPublicKeyHex: getUserPubkeyHex },
      transportSk,
      // Confirmed + retried delivery of the transport response (ping / get_public_key). The
      // dispatcher hands us the already-encoded event; publish it to the client's relays and
      // confirm via the relay OK (Amber parity) so get_public_key is not silently dropped.
      send: (responseEvent) => publishResponse(relaySnapshot, () => responseEvent),
    })
    await dispatcher.dispatch(decoded, event)
  }

  // -- the dispatch stage: route a decoded request to the right handler.
  const dispatch = async (decoded: DecodedRequest, event: Event): Promise<void> => {
    log(
      signerLogFields({
        method: decoded.request.method,
        clientPubkey: decoded.clientPubkey,
      }),
    )
    const method = decoded.request.method
    if (method === "sign_event") return runSignEvent(decoded)
    if (CAPABILITY_METHODS.has(method)) return runCapability(decoded)
    const transportSk = await readTransportSk()
    // Metadata-only activity for get_public_key ("Read your public key", Amber parity). Record
    // ONCE per genuine request — skip if the ledger already saw this id (a STAGE_TIMEOUT retry),
    // so the Activity list shows one row, not one per redelivery.
    if (method === "get_public_key") {
      const seen = await ledger.lookup(decoded.clientPubkey, decoded.request.id)
      if (!seen) {
        recordActivity(decoded.clientPubkey, {
          method: "get_public_key",
          accepted: true,
        })
      }
    }
    return dispatchTransport(decoded, event, transportSk)
  }

  // -- decode: real decode needs the transport secret in a sync cache (the pipeline's decode
  //    stage is sync). handleInbound + activate prime it before any inbound event is decoded.
  //    Tests inject decodeForTest to exercise wiring without crypto.
  let transportSkCache: string | null = null
  const primeTransportSk = async (): Promise<void> => {
    if (transportSkCache !== null) return
    const sk = await readTransportSk()
    if (transportSkCache === null) transportSkCache = sk
  }
  const decode =
    deps.decodeForTest ??
    ((event: Event): DecodedRequest => {
      if (transportSkCache === null) {
        throw new Error("transport secret not primed (activate the runtime first)")
      }
      return decodeRequest(event, transportSkCache)
    })

  // -- the ONE inbound pipeline: verify → decode → dispatch (verify-first, AD-16).
  const pipeline: InboundPipeline = createInboundPipeline({
    verify: (event) => verifyEvent(event),
    decode,
    dispatch,
    log,
  })

  // Encode + publish the NIP-46 connect-ack: a kind-24133 response whose `result` echoes the
  // secret VERBATIM (the plugin accepts `result === secret`). Without this the handshake never
  // completes and the verifier waits forever ("Waiting for signer approval…").
  //
  // Amber-parity ordering (BunkerRequestUtils.kt): BEFORE publishing the ack we (1) merge the
  // URI relays into the active snapshot and (2) register the listening #p subscription across
  // them, so the client's follow-up get_public_key / sign_event has a subscriber the instant it
  // arrives (the RPC is ephemeral — no subscriber means the relay drops it). Then the ack is
  // published with confirmed + retried delivery, re-encoding a fresh event (new created_at → new
  // id) per attempt so a relay that already rejected the prior copy still accepts a retry.
  const sendConnectAckImpl = async (ack: {
    clientPubkey: string
    result: string
    relays: string[]
  }): Promise<void> => {
    await primeTransportSk()
    if (transportSkCache === null) return
    const sk = transportSkCache

    // (1)+(2): warm sockets, widen the snapshot, and register the listening REQ FIRST.
    relaySnapshot = Array.from(new Set([...relaySnapshot, ...ack.relays]))
    await ensureRelays(ack.relays)
    resubscribe()

    // (3): confirmed + retried ack publish (echoed secret, or "ack"), fresh event per attempt.
    const ok = await publishConfirmed(ack.relays, () =>
      encodeResponse(
        { id: ack.clientPubkey, result: ack.result },
        { scheme: "nip44", clientPubkey: ack.clientPubkey, transportSk: sk },
      ),
    )
    if (!ok) log({ dropped: "connect-ack-unconfirmed" })
  }

  // -- connect-flow (Story 3.3): the nostrconnect:// handshake, coordinator-gated.
  const connectFlow: ConnectFlow = createConnectFlow({
    store,
    requestApproval: (request) =>
      raiseApproval({
        id: request.clientPubkey,
        kind: "connection",
        clientPubkey: request.clientPubkey,
        metadata: request.metadata,
      }).then((approved) => {
        if (approved) {
          // Record the "Connect" activity (Amber parity) and begin waiting for the login
          // follow-up (the client's sign_event lands a moment later over the relay). The waiting
          // overlay reads awaitingFollowup; it clears on the confirmed sign-in or on timeout.
          recordActivity(request.clientPubkey, { method: "connect", accepted: true })
          startAwaiting({
            clientPubkey: request.clientPubkey,
            name: request.metadata.name,
            image: request.metadata.image,
          })
        }
        return { approved }
      }),
    // Same-identity re-login: surface the Replace / Keep both / Cancel prompt via the runtime's
    // duplicate-prompt store (rendered by the ApprovalSurfaceHost as its own overlay).
    resolveDuplicate: (request) => duplicatePrompt.prompt(request),
    sendConnectAck: (ack) => fireAndForget(() => sendConnectAckImpl(ack), log),
    sendRejection: () => undefined,
  })

  // -- entry-point activation (AD-13): prime the transport secret, then subscribe the pool to
  //    the current connections' relays.
  let subscription: { close: () => void } | null = null
  const onInbound = (e: unknown): void => {
    fireAndForget(() => pipeline.handleInbound(e as Event), log)
  }
  // The device-local transport x-only pubkey (hex), derived from the cached transport secret.
  // Used to scope the relay subscription to events ADDRESSED to us (#p filter).
  const transportPubkeyHex = (): string | null =>
    transportSkCache === null
      ? null
      : bytesToHex(schnorr.getPublicKey(hexToBytes(transportSkCache)))

  // (Re)subscribe the pool to the CURRENT relay snapshot. Closes any prior subscription first so
  // a newly-connected client's relays (added on connect) are actually listened to — otherwise the
  // follow-up get_public_key / sign_event after the connect-ack would never be received. The
  // filter is scoped with `#p: [transportPubkey]` so we only ingest kind-24133 events ADDRESSED
  // to us — not all NIP-46 traffic on busy public relays (nos.lol / relay.primal.net).
  const resubscribe = (): void => {
    subscription?.close()
    subscription = null
    if (relaySnapshot.length === 0) return
    const pubkey = transportPubkeyHex()
    const filter: Record<string, unknown> = pubkey
      ? { "kinds": [NIP46_KIND], "#p": [pubkey] }
      : { kinds: [NIP46_KIND] }
    subscription = pool.subscribe(relaySnapshot, filter, { onevent: onInbound })
  }
  const activate = async (): Promise<void> => {
    await primeTransportSk()
    await syncSnapshots()
    resubscribe()
  }
  const deactivate = (): void => {
    subscription?.close()
    subscription = null
  }
  const entryPoints = {
    activate: () => fireAndForget(activate, log),
    deactivate,
  }

  const gateDeps: SignerGateDeps = {
    // Sync list() from the maintained snapshot (the async store is bridged on connect/activate).
    connectionStore: { list: () => recordSnapshot },
    relayPool: {
      openForConnections: (records) => {
        relaySnapshot = Array.from(new Set(records.flatMap((r) => r.relays)))
        fireAndForget(activate, log)
      },
      closeAll: deactivate,
    },
    entryPoints,
  }

  // Prime the snapshot once at construction (empty until the first connection).
  fireAndForget(syncSnapshots, log)

  // Connect de-dup guard (Fix B). The QR scanner fires per-frame AND the deep-link + QR entry
  // points can both deliver the SAME nostrconnect:// URI, so `handleConnectUri` may be invoked
  // multiple times for one client — concurrently OR staggered (the connect flow is fast because
  // the ack is fire-and-forget, so an in-flight-only guard clears before the second forward
  // arrives). Each extra invocation enqueues its own connection approval → the duplicate approve
  // modal + a second stored connection. We therefore remember each clientPubkey for a short TTL
  // and drop any repeat within the window (covers concurrent AND staggered duplicates).
  const recentConnects = new Map<string, number>()
  const CONNECT_DEDUP_TTL_MS = 60_000
  const isDuplicateConnect = (key: string): boolean => {
    const now = Date.now()
    // Sweep expired entries so the map cannot grow unbounded.
    for (const [k, ts] of recentConnects) {
      if (now - ts > CONNECT_DEDUP_TTL_MS) recentConnects.delete(k)
    }
    if (recentConnects.has(key)) return true
    recentConnects.set(key, now)
    return false
  }

  return {
    handleInbound: async (event) => {
      // Ensure the transport secret is available for the sync decode stage before the pipeline
      // runs (activation also primes it; this covers direct/first-event calls).
      await primeTransportSk()
      await pipeline.handleInbound(event)
    },
    handleConnectUri: async (rawUri) => {
      const parsed = parseNostrConnectUri(rawUri)
      const key = parsed?.clientPubkey
      if (key && isDuplicateConnect(key)) {
        log({ dropped: "duplicate-connect" })
        return
      }
      await connectFlow.handleConnect(rawUri)
      await syncSnapshots()
      // Listen on the newly-connected client's relays for the follow-up get_public_key /
      // sign_event that complete sign-in.
      resubscribe()
    },
    coordinator,
    gateDeps,
    listConnections: () => store.list(),
    relayHealth: () => Object.fromEntries(relayAccepts),
    disconnect: async (clientPubkey) => {
      await store.disconnect(clientPubkey)
      await syncSnapshots()
      resubscribe()
    },
    duplicatePrompt,
    awaitingFollowup,
    listActivity: (clientPubkey) => activityLog.list(clientPubkey),
    activityStats: (clientPubkey) => activityLog.stats(clientPubkey),
    subscribeActivity: (listener) => activityLog.subscribe(listener),
    grantForTest: async (clientPubkey, grantedScopes) => {
      await store.upsert({
        clientPubkey,
        relays: [],
        grantedScopes: grantedScopes.includes(GRANTABLE_SCOPE) ? [GRANTABLE_SCOPE] : [],
        metadata: {},
        createdAt: Math.floor(Date.now() / 1000),
      })
      await syncSnapshots()
    },
  }
}
