/**
 * ConnectFlow (Story 3.3 / AD-8 / AD-9) — owns the nostrconnect:// handshake.
 *
 * Flow: parse the URI → raise the CONNECTION approval DECISION through the injected
 * ApprovalCoordinator port (ConnectFlow NEVER raises a surface directly, AD-9) → on approve,
 * send the connect-response (the URI `secret` echoed VERBATIM, or the literal "ack" when the URI
 * carried no secret) and create the ConnectionStore record ONLY once that response is sent → on
 * reject, write no record and send the spec rejection.
 *
 * Security invariants:
 *  - The `secret` is OPTIONAL (interop). Historically we REQUIRED it as Mike Dilger / QRLjacking
 *    hardening, but real clients (Plebeian.market; Amber accepts them too) omit it, so a
 *    secret-less URI is now accepted and answered with "ack". The consent gate is the EXPLICIT
 *    HUMAN connection approval — a secret-less URI still cannot connect without a tap. When a
 *    secret IS present it is echoed verbatim (strong session binding) and NEVER persisted.
 *  - The grantable set is `sign_event:22242` (auth challenge) + origin-bound `sign_event:27235`
 *    (NIP-98). Any other requested perm is denied-by-default at grant time.
 *  - No raw scope string reaches the human — the approval decision carries client identity +
 *    human-meaning perms only (the screen renders human copy; Story 3.4 owns the surface).
 *
 * AD-1: transport is UI-free. The approval coordinator, ack/rejection senders, and the store
 * are injected ports so the handshake is unit-testable without UI or relays.
 */
import {
  GRANTABLE_SCOPES,
  type ClientMetadata,
  type ConnectionStore,
} from "@app/nostr/core/connection-store"
import { normalizeHost } from "@app/nostr/core/url-origin"

/** Parsed nostrconnect:// URI. `secret` is OPTIONAL (see the secret note below). */
export interface NostrConnectUri {
  clientPubkey: string
  relays: string[]
  /**
   * The connect `secret` when the URI carried one, else undefined. Historically we REQUIRED a
   * secret (Mike Dilger / QRLjacking hardening). We now accept secret-less URIs for interop with
   * clients that omit it (Plebeian.market, and Amber accepts them too): the connect-response then
   * replies the literal "ack" instead of an echoed secret. The real consent gate remains the
   * EXPLICIT human connection approval — a secret-less URI still cannot connect without a tap.
   */
  secret?: string
  /** Requested permissions in raw form (used only to decide the fixed grant). */
  perms: string[]
  metadata: ClientMetadata
}

/** Cap on any single URI-derived string we keep (defensive: the URI is attacker-influenced). */
const MAX_FIELD_LEN = 2048

/** M4/F5 fix (audit): relay hygiene for URI-supplied relay endpoints. */
const MAX_RELAYS = 10

/** A nostr NIP-46 client pubkey is a 32-byte x-only key: 64 lowercase/uppercase hex chars. */
const isClientPubkeyHex = (value: string): boolean => /^[0-9a-fA-F]{64}$/.test(value)

/**
 * Keep only ws://|wss:// relay URLs (F5: a crafted URI must not make the device open
 * arbitrary-protocol sockets, and cleartext ws is at least explicit), dedupe, and cap the
 * count (M4: unbounded relay lists are a cheap resource-exhaustion vector).
 */
export const sanitizeRelaySet = (rawRelays: string[]): string[] => {
  const seen = new Set<string>()
  return rawRelays
    .filter(
      (raw): raw is string =>
        typeof raw === "string" &&
        raw.length > 0 &&
        raw.length <= MAX_FIELD_LEN &&
        /^wss?:\/\//i.test(raw),
    )
    .filter((raw) => {
      const key = raw.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_RELAYS)
}

/** Keep only http(s) urls (origin-binding + display); anything else is dropped. */
const sanitizeHttpUrl = (raw: unknown): string | undefined => {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_FIELD_LEN) return
  try {
    const u = new URL(raw)
    return u.protocol === "https:" || u.protocol === "http:" ? raw : undefined
  } catch {
    return undefined
  }
}

const sanitizeString = (raw: unknown): string | undefined =>
  typeof raw === "string" && raw.length > 0 && raw.length <= MAX_FIELD_LEN
    ? raw
    : undefined

const splitPerms = (raw: string | undefined | null): string[] =>
  raw
    ? raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    : []

/**
 * Parse the `metadata=` JSON blob some clients send (Plebeian.market; Amber parses it too) as a
 * FALLBACK for name/url/image/perms. Defensive: attacker-influenced input, so parse in try/catch,
 * whitelist only the fields we use, cap lengths, and accept only http(s) urls. `icons[0]` is used
 * as the image when `image` is absent (Plebeian sends `icons: []`).
 */
const parseMetadataBlob = (
  raw: string,
): { name?: string; url?: string; image?: string; perms: string[] } => {
  try {
    const blob = JSON.parse(raw) as Record<string, unknown>
    if (!blob || typeof blob !== "object") return { perms: [] }
    const icons = Array.isArray(blob.icons) ? blob.icons : []
    return {
      name: sanitizeString(blob.name),
      url: sanitizeHttpUrl(blob.url),
      image: sanitizeHttpUrl(blob.image) ?? sanitizeHttpUrl(icons[0]),
      perms: splitPerms(typeof blob.perms === "string" ? blob.perms : ""),
    }
  } catch {
    return { perms: [] }
  }
}

/**
 * Parse and validate a nostrconnect:// URI. Returns null (no side effects) ONLY if the scheme is
 * wrong or the client pubkey is missing — a missing `secret` is NO LONGER a rejection (see the
 * secret note on NostrConnectUri). Identity/perms come from the separate query params, falling
 * back to a `metadata=` JSON blob when those params are absent.
 */
export const parseNostrConnectUri = (uri: string): NostrConnectUri | null => {
  if (!uri.startsWith("nostrconnect://")) return null

  const withoutScheme = uri.slice("nostrconnect://".length)
  const queryStart = withoutScheme.indexOf("?")
  const clientPubkey =
    queryStart === -1 ? withoutScheme : withoutScheme.slice(0, queryStart)
  // M4 fix (audit): the pubkey is used as a store key AND as the ECDH peer for the ack —
  // anything that is not a 64-char hex key is rejected outright (no side effects), instead of
  // poisoning the ConnectionStore and losing the ack in a thrown conversation-key derivation.
  if (!isClientPubkeyHex(clientPubkey)) return null
  // Normalize to lowercase: inbound event pubkeys are lowercase hex (NIP-01), and every
  // consumer (isConnected, grants, tombstones) matches by exact string — an uppercase URI
  // would otherwise create a connection record that never matches its own requests.
  const clientPubkeyNormalized = clientPubkey.toLowerCase()

  const params = new URLSearchParams(
    queryStart === -1 ? "" : withoutScheme.slice(queryStart + 1),
  )

  // Secret is optional now. An empty string is treated as absent (reply "ack").
  const secretParam = params.get("secret")
  const secret = secretParam && secretParam.length > 0 ? secretParam : undefined

  // The metadata= blob is a FALLBACK; separate params win when both are present.
  const blobRaw = params.get("metadata")
  const blob = blobRaw ? parseMetadataBlob(blobRaw) : { perms: [] as string[] }

  const perms = splitPerms(params.get("perms"))
  const effectivePerms = perms.length > 0 ? perms : blob.perms

  const metadata: ClientMetadata = {}
  const name = sanitizeString(params.get("name")) ?? blob.name
  const url = sanitizeHttpUrl(params.get("url")) ?? blob.url
  const image = sanitizeHttpUrl(params.get("image")) ?? blob.image
  if (name) metadata.name = name
  if (url) metadata.url = url
  if (image) metadata.image = image

  return {
    clientPubkey: clientPubkeyNormalized,
    // M4/F5 fix: ws(s)-only, deduped, capped (see sanitizeRelaySet).
    relays: sanitizeRelaySet(params.getAll("relay")),
    secret,
    perms: effectivePerms,
    metadata,
  }
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

/** The connect-ack payload. `result` is the secret echoed verbatim, or "ack" when secret-less. */
export interface ConnectAck {
  clientPubkey: string
  /** The connect-response result: the URI secret echoed verbatim, or the literal "ack". */
  result: string
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
 * Map the raw requested perms to the human-meaning descriptors shown to the user. Two grantable
 * shapes: the opaque auth-challenge ("sign-in-and-sign") and NIP-98 HTTP auth, which is surfaced
 * WITH the app host ("sign-in-http:<host>") so the connect approval is informed consent for the
 * exact origin. No raw scope string is ever surfaced.
 */
const toHumanPerms = (perms: string[], host: string | null): string[] => {
  const out: string[] = []
  if (perms.includes("sign_event:22242")) out.push("sign-in-and-sign")
  if (perms.includes("sign_event:27235")) {
    out.push(host ? `sign-in-http:${host}` : "sign-in-http")
  }
  return out
}

export const createConnectFlow = (ports: ConnectFlowPorts): ConnectFlow => {
  const { store, requestApproval, resolveDuplicate, sendConnectAck, sendRejection } =
    ports

  return {
    async handleConnect(uri: string): Promise<void> {
      const parsed = parseNostrConnectUri(uri)
      // Secret-less / malformed → drop before any approval surface (no side effects).
      if (!parsed) return

      const host = normalizeHost(parsed.metadata.url ?? "")
      const decision = await requestApproval({
        kind: "connection",
        clientPubkey: parsed.clientPubkey,
        metadata: parsed.metadata,
        humanPerms: toHumanPerms(parsed.perms, host),
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

      // Approved: send the connect-response FIRST — a connection exists ONLY once acked. The
      // result echoes the URI secret verbatim, or is the literal "ack" for a secret-less URI
      // (NIP-46 / Amber parity). The ack must reach the client on the relays it advertised (AD-11).
      sendConnectAck({
        clientPubkey: parsed.clientPubkey,
        result: parsed.secret ?? "ack",
        relays: parsed.relays,
      })

      // Grant = the intersection of requested perms with the grantable set (e.g.
      // ["sign_event:27235"] for vezir, ["sign_event:22242"] for the plugin). The 27235 grant only
      // ever PRE-APPROVES when origin-bound at policy time (metadata.url host == u-tag host); if
      // no url was sent it is stored but never silently honored — safe by construction. Secret NOT
      // persisted.
      const grantedScopes = parsed.perms.filter((p) =>
        (GRANTABLE_SCOPES as readonly string[]).includes(p),
      )
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
