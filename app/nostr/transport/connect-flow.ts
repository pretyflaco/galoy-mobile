/**
 * ConnectFlow (Story 3.3 / AD-8 / AD-9) — owns the nostrconnect:// handshake.
 *
 * Flow: parse the URI (mandatory secret) → raise the CONNECTION approval DECISION through the
 * injected ApprovalCoordinator port (ConnectFlow NEVER raises a surface directly, AD-9) → on
 * approve, send the connect-ack echoing the URI `secret` VERBATIM and create the
 * ConnectionStore record ONLY once that echo is sent → on reject, write no record and send the
 * spec rejection.
 *
 * Security invariants:
 *  - The `secret` is MANDATORY. A secret-less URI is rejected BEFORE any approval surface —
 *    pairing without a secret is the Mike Dilger connection-hijacking attack (hardened clients
 *    reject it). The secret is transient handshake state: used once, NEVER persisted.
 *  - The v1 grantable set is EXACTLY `sign_event:22242`. Any other requested perm is
 *    denied-by-default at grant time; `grantedScopes` is `['sign_event:22242']` or `[]`.
 *  - No raw scope string reaches the human — the approval decision carries client identity +
 *    human-meaning perms only (the screen renders human copy; Story 3.4 owns the surface).
 *
 * AD-1: transport is UI-free. The approval coordinator, ack/rejection senders, and the store
 * are injected ports so the handshake is unit-testable without UI or relays.
 */
import {
  GRANTABLE_SCOPE,
  type ClientMetadata,
  type ConnectionStore,
} from "@app/nostr/core/connection-store"

/** Parsed nostrconnect:// URI (secret guaranteed non-empty when non-null). */
export interface NostrConnectUri {
  clientPubkey: string
  relays: string[]
  secret: string
  /** Requested permissions in raw form (used only to decide the fixed grant). */
  perms: string[]
  metadata: ClientMetadata
}

/**
 * Parse and validate a nostrconnect:// URI. Returns null (no side effects) if the scheme is
 * wrong, the client pubkey is missing, or the mandatory secret is absent/empty.
 */
export const parseNostrConnectUri = (uri: string): NostrConnectUri | null => {
  if (!uri.startsWith("nostrconnect://")) return null

  const withoutScheme = uri.slice("nostrconnect://".length)
  const queryStart = withoutScheme.indexOf("?")
  const clientPubkey =
    queryStart === -1 ? withoutScheme : withoutScheme.slice(0, queryStart)
  if (!clientPubkey) return null

  const params = new URLSearchParams(
    queryStart === -1 ? "" : withoutScheme.slice(queryStart + 1),
  )

  const secret = params.get("secret")
  if (!secret) return null // mandatory-secret (Mike Dilger) — reject before any surface

  const permsRaw = params.get("perms")
  const perms = permsRaw
    ? permsRaw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    : []

  const metadata: ClientMetadata = {}
  const name = params.get("name")
  const url = params.get("url")
  const image = params.get("image")
  if (name) metadata.name = name
  if (url) metadata.url = url
  if (image) metadata.image = image

  return { clientPubkey, relays: params.getAll("relay"), secret, perms, metadata }
}

/** The connection-approval decision surfaced through the coordinator (human meaning only). */
export interface ConnectionApprovalRequest {
  kind: "connection"
  clientPubkey: string
  metadata: ClientMetadata
  /** Human-meaning permission descriptors — NEVER raw scope strings. */
  humanPerms: string[]
}

export interface ApprovalDecision {
  approved: boolean
}

/**
 * How to resolve a re-login by an app that is ALREADY connected under a different (ephemeral)
 * pubkey. `replace` disconnects the prior record(s) and keeps only the new connection; `keep`
 * lets both coexist; `cancel` aborts (send rejection, write nothing).
 */
export type DuplicateResolution = "replace" | "keep" | "cancel"

/** The duplicate-connection prompt surfaced when an identity re-connects (Replace/Keep/Cancel). */
export interface DuplicateConnectionRequest {
  clientPubkey: string
  metadata: ClientMetadata
  /** The existing record(s) for the same identity (different pubkey). */
  existing: ConnectionRecordLike[]
}

/** Minimal existing-record shape the duplicate prompt needs (identity display). */
export interface ConnectionRecordLike {
  clientPubkey: string
  metadata: ClientMetadata
}

/** The connect-ack payload (echoes the secret verbatim). */
export interface ConnectAck {
  clientPubkey: string
  secret: string
  /** The relays (from the URI) the ack must be published to — the client is listening there. */
  relays: string[]
}

export interface ConnectFlowPorts {
  store: ConnectionStore
  /** Raise the connection-approval decision through the ApprovalCoordinator (Story 3.4). */
  requestApproval: (request: ConnectionApprovalRequest) => Promise<ApprovalDecision>
  /**
   * Resolve a re-login by an already-connected identity (Replace / Keep both / Cancel). Injected
   * so the transport stays UI-free; the runtime binds it to the approval overlay. Optional: when
   * absent, a duplicate is treated as "keep" (prior, non-deduping behavior).
   */
  resolveDuplicate?: (request: DuplicateConnectionRequest) => Promise<DuplicateResolution>
  /** Send the connect-ack (echoing the secret) to the client. */
  sendConnectAck: (ack: ConnectAck) => void
  /** Send the spec-appropriate rejection to the client. */
  sendRejection: (clientPubkey: string) => void
}

export interface ConnectFlow {
  handleConnect(uri: string): Promise<void>
}

/**
 * Map the raw requested perms to the human-meaning descriptors shown to the user. In v1 the
 * only meaningful grant is sign-in + sign-on-your-behalf (the sign_event:22242 grant); no raw
 * scope is ever surfaced.
 */
const toHumanPerms = (perms: string[]): string[] =>
  perms.includes(GRANTABLE_SCOPE) ? ["sign-in-and-sign"] : []

export const createConnectFlow = (ports: ConnectFlowPorts): ConnectFlow => {
  const { store, requestApproval, resolveDuplicate, sendConnectAck, sendRejection } =
    ports

  return {
    async handleConnect(uri: string): Promise<void> {
      const parsed = parseNostrConnectUri(uri)
      // Secret-less / malformed → drop before any approval surface (no side effects).
      if (!parsed) return

      const decision = await requestApproval({
        kind: "connection",
        clientPubkey: parsed.clientPubkey,
        metadata: parsed.metadata,
        humanPerms: toHumanPerms(parsed.perms),
      })

      if (!decision.approved) {
        sendRejection(parsed.clientPubkey)
        return
      }

      // Same-identity re-login guard: an app reconnecting mints a fresh ephemeral pubkey, so a
      // naive upsert would accrete a duplicate row every sign-in. If a record already exists for
      // this identity (metadata.url ?? metadata.name) under a DIFFERENT pubkey, ask the user how
      // to resolve it before writing anything.
      const identity = parsed.metadata.url ?? parsed.metadata.name ?? ""
      const duplicates = await store.findByIdentity(identity, parsed.clientPubkey)
      if (duplicates.length > 0 && resolveDuplicate) {
        const resolution = await resolveDuplicate({
          clientPubkey: parsed.clientPubkey,
          metadata: parsed.metadata,
          existing: duplicates.map((r) => ({
            clientPubkey: r.clientPubkey,
            metadata: r.metadata,
          })),
        })
        if (resolution === "cancel") {
          sendRejection(parsed.clientPubkey)
          return
        }
        if (resolution === "replace") {
          // Drop the stale connection(s) for this identity; only the new one survives.
          for (const dup of duplicates) {
            await store.disconnect(dup.clientPubkey)
          }
        }
        // "keep" falls through: both records coexist.
      }

      // Approved: echo the secret VERBATIM first — a connection exists ONLY on echo. The ack
      // must reach the client on the relays it advertised in the URI (AD-11).
      sendConnectAck({
        clientPubkey: parsed.clientPubkey,
        secret: parsed.secret,
        relays: parsed.relays,
      })

      // Fixed grant: exactly sign_event:22242 if requested, else empty. Secret NOT persisted.
      const grantedScopes = parsed.perms.includes(GRANTABLE_SCOPE)
        ? [GRANTABLE_SCOPE]
        : []
      await store.upsert({
        clientPubkey: parsed.clientPubkey,
        relays: parsed.relays,
        grantedScopes,
        metadata: parsed.metadata,
        createdAt: Math.floor(Date.now() / 1000),
      })
    },
  }
}
