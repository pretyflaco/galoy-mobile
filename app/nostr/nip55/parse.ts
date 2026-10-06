/**
 * NIP-55 request parsing + validation (UI-free, fail-closed).
 *
 * Everything the native side hands over is untrusted input: the data URI is decoded
 * defensively, the permissions list is validated against the grantable set (Blink serves
 * ONLY sign_event:27235 over NIP-55 — matching the POC's grantable scopes), and the
 * unsigned event JSON is coerced into the SAME `RawSignEventParams` shape the NIP-46
 * path normalizes (sig dropped, id recomputed unconditionally — AD-16).
 */
import * as nip19 from "nostr-tools/nip19"

import type { RawSignEventParams } from "../transport/sign-event"
import type { Nip55PendingRequest, Nip55Result } from "./types"

const HEX64 = /^[0-9a-fA-F]{64}$/

/** The ONLY permission Blink grants over NIP-55 (mirrors GRANTABLE_SCOPES for login kinds). */
export const NIP55_GRANTABLE_PERMISSIONS: ReadonlySet<string> = new Set([
  "sign_event:27235",
])

/** A parsed entry of the `permissions` extra: `{"type":"sign_event","kind":27235}`. */
export interface Nip55Permission {
  type: string
  kind?: number
}

/** The fully parsed, validated request the handler dispatches on. */
export type Nip55ParsedRequest =
  | { type: "get_public_key"; permissions: Nip55Permission[] }
  | { type: "sign_event"; params: RawSignEventParams; currentUserHex: string }

/**
 * Decode the intent data payload: strip the `nostrsigner:` scheme and percent-decode.
 * A raw `+` is treated as a LITERAL plus (never a space) — the same guard Amber applies
 * before URL-decoding, for clients that under-encode.
 */
export const decodeNip55Data = (data: string): string | null => {
  try {
    const withoutScheme = data.startsWith("nostrsigner:")
      ? data.slice("nostrsigner:".length)
      : data
    return decodeURIComponent(withoutScheme.replace(/\+/g, "%2B"))
  } catch {
    return null
  }
}

/** Normalize a pubkey from hex or npub to lowercase x-only hex; null when neither. */
export const toHexPubkey = (value: string): string | null => {
  const trimmed = value.trim()
  if (HEX64.test(trimmed)) return trimmed.toLowerCase()
  if (trimmed.startsWith("npub1")) {
    try {
      return (nip19.decode(trimmed).data as string).toLowerCase()
    } catch {
      return null
    }
  }
  return null
}

/** Pseudo client key for the approval entries: caller-package-scoped, never 64-hex (no
 *  collision with real NIP-46 client pubkeys in the coordinator/grant machinery). */
export const pseudoClientKey = (callerPackage?: string | null): string =>
  `nip55:${callerPackage ?? "unknown"}`

/** The per-type rejection result (Amber parity: login rejects cancel, sign rejects flag). */
export const rejectionForType = (raw: Nip55PendingRequest): Nip55Result =>
  raw.type === "sign_event"
    ? { kind: "sign_reject", id: raw.id }
    : { kind: "login_reject", id: raw.id }

/** Parse + fail-closed validate the `permissions` extra. Missing/empty ⇒ no permissions. */
export const parseNip55Permissions = (
  permissionsJson: string | null | undefined,
): Nip55Permission[] | null => {
  if (!permissionsJson) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(permissionsJson)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const permissions: Nip55Permission[] = []
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return null
    const type = (entry as Record<string, unknown>).type
    const kind = (entry as Record<string, unknown>).kind
    if (typeof type !== "string") return null
    if (kind !== undefined && typeof kind !== "number") return null
    // Fail-closed: Blink serves ONLY the grantable login-sign permission over NIP-55.
    if (`${type}:${kind}` !== "sign_event:27235") return null
    permissions.push(kind === undefined ? { type } : { type, kind })
  }
  return permissions
}

/** Coerce a decoded JSON object into `RawSignEventParams`; null on any malformed field. */
export const coerceSignEventParams = (obj: unknown): RawSignEventParams | null => {
  if (typeof obj !== "object" || obj === null) return null
  const record = obj as Record<string, unknown>
  const kind = record.kind
  const content = record.content
  const tags = record.tags
  const createdAt = record.created_at
  const pubkey = record.pubkey
  const eventId = record.id
  const sig = record.sig

  if (typeof kind !== "number" || !Number.isInteger(kind)) return null
  if (content !== undefined && typeof content !== "string") return null
  if (createdAt !== undefined && typeof createdAt !== "number") return null
  if (pubkey !== undefined && typeof pubkey !== "string") return null
  if (eventId !== undefined && typeof eventId !== "string") return null
  if (sig !== undefined && typeof sig !== "string") return null
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (!Array.isArray(tag) || tag.some((t) => typeof t !== "string")) return null
    }
  } else if (tags !== undefined) {
    return null
  }

  // Only validated fields are carried; the flow recomputes `id` and drops `sig` regardless.
  const params: RawSignEventParams = {
    kind,
    content: typeof content === "string" ? content : "",
  }
  if (Array.isArray(tags)) params.tags = tags as string[][]
  // eslint-disable-next-line camelcase
  if (typeof createdAt === "number") params.created_at = createdAt
  if (typeof pubkey === "string") params.pubkey = pubkey
  if (typeof eventId === "string") params.id = eventId
  if (typeof sig === "string") params.sig = sig
  return params
}

/** Parse a raw pending request into a dispatchable one; null ⇒ reject (fail-closed). */
export const parseNip55Request = (
  raw: Nip55PendingRequest,
): Nip55ParsedRequest | null => {
  if (raw.type === "get_public_key") {
    const permissions = parseNip55Permissions(raw.permissions)
    return permissions === null ? null : { type: "get_public_key", permissions }
  }
  if (raw.type === "sign_event") {
    if (!raw.data) return null
    const decoded = decodeNip55Data(raw.data)
    if (decoded === null) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(decoded)
    } catch {
      return null
    }
    const params = coerceSignEventParams(parsed)
    if (params === null) return null
    if (!raw.currentUser) return null
    const currentUserHex = toHexPubkey(raw.currentUser)
    if (currentUserHex === null) return null
    return { type: "sign_event", params, currentUserHex }
  }
  return null
}
