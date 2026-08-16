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
import { verifyEvent, type Event } from "nostr-tools/pure"

import {
  initApprovalCoordinator,
  type ApprovalCoordinator,
  type ApprovalEntry,
} from "./approval/coordinator"
import { grantCoverageFromPolicy } from "./approval/grant-adapter"
import {
  createConnectionStore,
  GRANTABLE_SCOPE,
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
import { decodeRequest, NIP46_KIND, type DecodedRequest } from "./transport/nip46-codec"
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
    await flow.handle(raw)
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
    await flow.handle({
      method: decoded.request.method as CapabilityMethod,
      peerPubkey: decoded.request.params[0] ?? "",
      payload: decoded.request.params[1] ?? "",
    })
  }

  // -- transport dispatcher (Story 3.2): ping / get_public_key / connect + ledger + respond-in-kind.
  const dispatchTransport = async (
    decoded: DecodedRequest,
    event: Event,
    transportSk: string,
  ): Promise<void> => {
    const dispatcher = createRequestDispatcher({
      ledger,
      methodPorts: { getPublicKey: () => signer.getPublicKey() },
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

  // -- decode: real decode needs the transport secret; primed on activation (sync cache). Tests
  //    inject decodeForTest to exercise wiring without crypto.
  let transportSkCache: string | null = null
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
    sendConnectAck: () => undefined, // encoded-ack send is wired once the ack codec lands in the provider
    sendRejection: () => undefined,
  })

  // -- entry-point activation (AD-13): prime the transport secret, then subscribe the pool to
  //    the current connections' relays.
  let subscription: { close: () => void } | null = null
  const onInbound = (e: unknown): void => {
    fireAndForget(() => pipeline.handleInbound(e as Event), log)
  }
  const activate = async (): Promise<void> => {
    if (transportSkCache === null && deps.readTransportSkHex) {
      // Read into a local, then assign ONCE — never reassign the cache based on a stale read.
      const sk = await deps.readTransportSkHex()
      if (transportSkCache === null) transportSkCache = sk
    }
    await syncSnapshots()
    if (subscription || relaySnapshot.length === 0) return
    subscription = pool.subscribe(
      relaySnapshot,
      { kinds: [NIP46_KIND] },
      { onevent: onInbound },
    )
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
    handleInbound: (event) => pipeline.handleInbound(event),
    handleConnectUri: async (rawUri) => {
      await connectFlow.handleConnect(rawUri)
      await syncSnapshots()
    },
    coordinator,
    gateDeps,
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
