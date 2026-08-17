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
  createConnectionStore,
  GRANTABLE_SCOPE,
  type ConnectionRecord,
  type ConnectionStorage,
  type ConnectionStore,
} from "./core/connection-store"
import { createLocalNsecSigner } from "./core/local-nsec-signer"
import { signerLogFields } from "./core/redact"
import { createRequestLedger } from "./core/request-ledger"
import type { ConnectionRecordLike, SignerGateDeps } from "./signer-gate"
import { createConnectFlow, type ConnectFlow } from "./transport/connect-flow"
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
  /** Atomically disconnect a client (delete record + void grant + tombstone) and re-sync. */
  disconnect(clientPubkey: string): Promise<void>
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

export const createSignerRuntime = (deps: SignerRuntimeDeps): SignerRuntime => {
  const log = deps.log ?? ((): void => undefined)
  const store: ConnectionStore = createConnectionStore(deps.storage)
  const signer = createLocalNsecSigner({ readNsecHex: deps.readNsecHex })
  const ledger = createRequestLedger(deps.storage)
  const pool = getRelayPool({ createPool: deps.createPool })

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
  const syncSnapshots = async (): Promise<void> => {
    const records = await store.list()
    recordSnapshot = toRecordLike(records)
    relaySnapshot = Array.from(new Set(records.flatMap((r) => r.relays)))
  }
  const publish = (event: Event): void => {
    if (relaySnapshot.length > 0) pool.publish(relaySnapshot, event)
  }

  // Encode a NIP-46 response in-kind (AD-10) with the device-local transport secret and publish
  // it back to the client. Used by the approval-gated flows (sign_event, nip04/nip44), which
  // otherwise compute a result the client would never receive.
  const sendResponse = async (
    response: Nip46Response,
    decoded: DecodedRequest,
  ): Promise<void> => {
    await primeTransportSk()
    if (transportSkCache === null) return
    publish(
      encodeResponse(response, {
        scheme: decoded.scheme,
        clientPubkey: decoded.clientPubkey,
        transportSk: transportSkCache,
      }),
    )
  }

  // -- sign_event flow (Story 3.5): approval-gated, signs through the seam only.
  const runSignEvent = async (decoded: DecodedRequest): Promise<void> => {
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
          humanAction: "sign-in-and-sign",
        }).then((approved) => ({ approved })),
    })
    const raw = JSON.parse(decoded.request.params[0] ?? "{}")
    const result = await flow.handle(raw)
    // Respond in-kind: the signed event JSON on success, a spec error on rejection.
    await sendResponse(
      result.ok
        ? { id: decoded.request.id, result: JSON.stringify(result.event) }
        : { id: decoded.request.id, error: result.error },
      decoded,
    )
  }

  // -- encrypt/decrypt flow (Story 3.6): each op raises its OWN fresh approval.
  const runCapability = async (decoded: DecodedRequest): Promise<void> => {
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
        }).then((approved) => ({ approved })),
    })
    const result = await flow.handle({
      method: decoded.request.method as CapabilityMethod,
      peerPubkey: decoded.request.params[0] ?? "",
      payload: decoded.request.params[1] ?? "",
    })
    await sendResponse(
      result.ok
        ? { id: decoded.request.id, result: result.result }
        : { id: decoded.request.id, error: result.error },
      decoded,
    )
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
      send: publish,
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

  // Publish an encoded NIP-46 event to a SPECIFIC relay set (used by the connect handshake,
  // whose target relays come from the URI and are not yet in the active snapshot).
  const publishTo = (relays: string[], event: Event): void => {
    if (relays.length > 0) pool.publish(relays, event)
  }

  // Encode + publish the NIP-46 connect-ack: a kind-24133 response whose `result` echoes the
  // secret VERBATIM (the plugin accepts `result === secret`). Without this the handshake never
  // completes and the verifier waits forever ("Waiting for signer approval…").
  const sendConnectAckImpl = async (ack: {
    clientPubkey: string
    secret: string
    relays: string[]
  }): Promise<void> => {
    await primeTransportSk()
    if (transportSkCache === null) return
    const event = encodeResponse(
      { id: ack.clientPubkey, result: ack.secret },
      { scheme: "nip44", clientPubkey: ack.clientPubkey, transportSk: transportSkCache },
    )
    publishTo(ack.relays, event)
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
      }).then((approved) => ({ approved })),
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

  return {
    handleInbound: async (event) => {
      // Ensure the transport secret is available for the sync decode stage before the pipeline
      // runs (activation also primes it; this covers direct/first-event calls).
      await primeTransportSk()
      await pipeline.handleInbound(event)
    },
    handleConnectUri: async (rawUri) => {
      await connectFlow.handleConnect(rawUri)
      await syncSnapshots()
      // Listen on the newly-connected client's relays for the follow-up get_public_key /
      // sign_event that complete sign-in.
      resubscribe()
    },
    coordinator,
    gateDeps,
    listConnections: () => store.list(),
    disconnect: async (clientPubkey) => {
      await store.disconnect(clientPubkey)
      await syncSnapshots()
      resubscribe()
    },
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
