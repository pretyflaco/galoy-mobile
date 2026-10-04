// Marmot push notifications v1 ("marmot-push-v1", features/push-notifications.md, the
// adopted MIP-05 successor) — the client side, shared by the app (token encryption,
// owner-signed self-updates) and the relay (record verification + state, kind 446
// triggers). The notification server itself is Transponder (marmot-protocol/transponder).
//
// Pure JS over @noble/* + nostr-tools (Hermes-safe: no crypto.subtle, no Buffer).
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js"
import { chacha20poly1305 } from "@noble/ciphers/chacha.js"
import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js"
import { generateSecretKey, getEventHash } from "nostr-tools/pure"
import { wrapEvent } from "nostr-tools/nip59"

export const PUSH_VERSION = "marmot-push-v1"
export const KIND_TRIGGER = 446
export const KIND_TOKEN_UPDATE = 447
export const KIND_TOKEN_LIST = 448
export const KIND_TOKEN_REMOVAL = 449
export const KIND_OWNER_PROOF = 451
export const MAX_ENTRIES = 32
export const MAX_FUTURE_MS = 3_600_000
/** M20 (Hermes #10): a fresh receiver (relay after a state wipe) accepted ANY old
 *  member-signed record — replay bound. 90 days: FCM tokens rotate long before, and a
 *  device whose only record is older loses push until its next announcement (its app
 *  re-announces per conversation/token refresh) — never the chat itself. */
export const MAX_RECORD_AGE_MS = 90 * 24 * 3_600_000

const PLATFORM_BYTE = { apns: 0x01, fcm: 0x02 }
const PLAINTEXT_SIZE = 1024
const ENCRYPTED_SIZE = 1084
const HKDF_SALT = new TextEncoder().encode("marmot-push-token-v1")
const HKDF_INFO = new TextEncoder().encode("marmot-push-token-encryption")
const DOMAIN_RECORD = "marmot-push-token-record-v1"
const DOMAIN_REMOVAL = "marmot-push-token-removal-v1"
const HEX32 = /^[0-9a-f]{64}$/
const HEX64B = /^[0-9a-f]{128}$/
const FINGERPRINT = /^sha256:[0-9a-f]{24}$/
const utf8 = (s) => new TextEncoder().encode(s)

// --- base64 (standard, padded) without Buffer ------------------------------------------
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
export function toBase64(bytes) {
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "="
    out += i + 2 < bytes.length ? B64[n & 63] : "="
  }
  return out
}
export function fromBase64(s) {
  if (typeof s !== "string" || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error("bad base64")
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0
  const out = new Uint8Array((s.length / 4) * 3 - pad)
  let o = 0
  for (let i = 0; i < s.length; i += 4) {
    const n = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | (s[i + k] === "=" ? 0 : B64.indexOf(s[i + k])), 0)
    for (const b of [(n >> 16) & 255, (n >> 8) & 255, n & 255]) if (o < out.length) out[o++] = b
  }
  return out
}

// --- token encryption ------------------------------------------------------------------
/** Platform token bytes: APNs = the raw device token (hex-decoded), FCM = UTF-8 of the registration token. */
export function deviceTokenBytes(platform, token) {
  if (platform === "apns") return hexToBytes(token)
  if (platform === "fcm") return utf8(token)
  throw new Error(`unknown platform ${platform}`)
}

function sharedKey(privkey, xonlyHex) {
  if (!HEX32.test(xonlyHex)) throw new Error("invalid x-only public key")
  // BIP-340 lift: the even-Y point; shared_x = X of the ECDH point, no hashing
  const point = secp256k1.getSharedSecret(privkey, hexToBytes("02" + xonlyHex))
  const sharedX = point.slice(1, 33)
  if (sharedX.every((b) => b === 0)) throw new Error("all-zero shared secret")
  return hkdf(sha256, sharedX, HKDF_SALT, HKDF_INFO, 32)
}

/** EncryptedToken (1084 bytes) for `serverPubkeyHex`. */
export function encryptToken({ platform, token, serverPubkeyHex }) {
  const dt = deviceTokenBytes(platform, token)
  if (dt.length < 1 || dt.length > 1021) throw new Error("device token must be 1..1021 bytes")
  const plain = randomBytes(PLAINTEXT_SIZE)
  plain[0] = PLATFORM_BYTE[platform]
  plain[1] = dt.length >> 8
  plain[2] = dt.length & 255
  plain.set(dt, 3)
  const eph = secp256k1.utils.randomSecretKey()
  const ephX = schnorr.getPublicKey(eph)
  const nonce = randomBytes(12)
  const ct = chacha20poly1305(sharedKey(eph, serverPubkeyHex), nonce).encrypt(plain)
  const out = new Uint8Array(ENCRYPTED_SIZE)
  out.set(ephX, 0)
  out.set(nonce, 32)
  out.set(ct, 44)
  return out
}

/** Server side (tests / a peer standing in for Transponder): → { platform, deviceToken } or throws. */
export function decryptToken(encrypted, serverPrivkey) {
  if (encrypted.length !== ENCRYPTED_SIZE) throw new Error("bad EncryptedToken size")
  const key = sharedKey(serverPrivkey, bytesToHex(encrypted.slice(0, 32)))
  const plain = chacha20poly1305(key, encrypted.slice(32, 44)).decrypt(encrypted.slice(44))
  const platform = Object.keys(PLATFORM_BYTE).find((p) => PLATFORM_BYTE[p] === plain[0])
  const len = (plain[1] << 8) | plain[2]
  if (!platform || len < 1 || len > 1021) throw new Error("invalid token plaintext")
  return { platform, deviceToken: plain.slice(3, 3 + len) }
}

export function tokenFingerprint(platform, token) {
  const dt = deviceTokenBytes(platform, token)
  const buf = new Uint8Array(1 + dt.length)
  buf[0] = PLATFORM_BYTE[platform]
  buf.set(dt, 1)
  return "sha256:" + bytesToHex(sha256(buf)).slice(0, 24)
}

// --- owner proof (kind 451, never published) -------------------------------------------
const relayHintOf = (e) => (typeof e.relay_hint === "string" && e.relay_hint.trim() ? e.relay_hint : "")

/** The exact unsigned kind-451 template a token (or, with removal=true, a removal) entry is signed over. */
export function ownerProofTemplate(entry, groupIdHex, { removal = false } = {}) {
  const tags = [
    ["d", removal ? DOMAIN_REMOVAL : DOMAIN_RECORD],
    ["group_id", groupIdHex],
    ["member_id", entry.member_id_hex],
    ["leaf_index", String(entry.leaf_index)],
    ["platform", entry.platform],
    ["server_pubkey", entry.server_pubkey_hex],
    ["token_fingerprint", entry.token_fingerprint],
    ["owner_ts", String(entry.owner_ts)],
    ["relay_hint", removal ? "" : relayHintOf(entry)],
  ]
  if (!removal) tags.push(["encrypted_token_encoding", "base64"])
  return { pubkey: entry.member_id_hex, created_at: 0, kind: KIND_OWNER_PROOF, tags, content: removal ? "" : entry.encrypted_token }
}
export const ownerProofId = (entry, groupIdHex, opts) => getEventHash(ownerProofTemplate(entry, groupIdHex, opts))

/**
 * Validate an externally signed proof event before copying its signature (spec: the
 * returned event must equal the request exactly, its id must recompute, the sig verify).
 */
export function acceptSignedProof(signed, template) {
  const same =
    signed?.pubkey === template.pubkey &&
    signed.created_at === template.created_at &&
    signed.kind === template.kind &&
    signed.content === template.content &&
    JSON.stringify(signed.tags) === JSON.stringify(template.tags)
  const id = getEventHash(template)
  if (!same || signed.id !== id || !HEX64B.test(signed.sig ?? "")) throw new Error("signer returned a different proof event")
  if (!schnorr.verify(hexToBytes(signed.sig), hexToBytes(id), hexToBytes(template.pubkey))) throw new Error("proof signature does not verify")
  return signed.sig
}

/** SignedRecord bytes → its SHA-256 (hex): the ordering tie-breaker. */
export function recordDigest(entry, groupIdHex, { removal = false } = {}) {
  const gid = hexToBytes(groupIdHex)
  const hint = removal ? new Uint8Array(0) : utf8(relayHintOf(entry))
  const enc = removal ? new Uint8Array(0) : fromBase64(entry.encrypted_token)
  const domain = utf8(removal ? DOMAIN_REMOVAL : DOMAIN_RECORD)
  const parts = [
    domain,
    u16(gid.length), gid,
    hexToBytes(entry.member_id_hex),
    u32(entry.leaf_index),
    new Uint8Array([PLATFORM_BYTE[entry.platform]]),
    hexToBytes(entry.server_pubkey_hex),
    hexToBytes(entry.token_fingerprint.slice(7)),
    u64(entry.owner_ts),
    u16(hint.length), hint,
    enc,
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const buf = new Uint8Array(total)
  let o = 0
  for (const p of parts) (buf.set(p, o), (o += p.length))
  return bytesToHex(sha256(buf))
}
const u16 = (n) => new Uint8Array([(n >> 8) & 255, n & 255])
const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
function u64(n) {
  const out = new Uint8Array(8)
  let v = BigInt(n)
  for (let i = 7; i >= 0; i--) ((out[i] = Number(v & 255n)), (v >>= 8n))
  return out
}

/** Structural + signature check of one entry; returns null when valid, else the reason. */
export function checkEntry(entry, groupIdHex, { removal = false, now = Date.now() } = {}) {
  if (!entry || typeof entry !== "object") return "not an object"
  if (!HEX32.test(entry.member_id_hex ?? "") || !HEX32.test(entry.server_pubkey_hex ?? "")) return "bad key hex"
  if (!Number.isSafeInteger(entry.leaf_index) || entry.leaf_index < 0 || entry.leaf_index > 0xffffffff) return "bad leaf_index"
  if (!(entry.platform in PLATFORM_BYTE)) return "unknown platform"
  if (!FINGERPRINT.test(entry.token_fingerprint ?? "")) return "bad fingerprint"
  if (!Number.isSafeInteger(entry.owner_ts) || entry.owner_ts < 0) return "bad owner_ts"
  if (entry.owner_ts > now + MAX_FUTURE_MS) return "owner_ts too far in the future"
  if (now - entry.owner_ts > MAX_RECORD_AGE_MS) return "owner_ts too old (replay bound, M20)"
  if (!HEX64B.test(entry.owner_sig ?? "")) return "bad owner_sig"
  if (entry.relay_hint !== undefined && typeof entry.relay_hint !== "string") return "bad relay_hint"
  if (!removal) {
    try {
      if (fromBase64(entry.encrypted_token).length !== ENCRYPTED_SIZE) return "bad encrypted_token size"
    } catch {
      return "bad encrypted_token"
    }
  }
  const id = ownerProofId(entry, groupIdHex, { removal })
  return schnorr.verify(hexToBytes(entry.owner_sig), hexToBytes(id), hexToBytes(entry.member_id_hex)) ? null : "owner_sig does not verify"
}

// --- app payloads (kinds 447/448/449) -------------------------------------------------
const rumorOf = (kind, pubkey, content) => {
  const r = { kind, pubkey, created_at: Math.floor(Date.now() / 1000), tags: [["v", PUSH_VERSION]], content: JSON.stringify(content) }
  return { ...r, id: getEventHash(r) } // unsigned app payload: an id, never a sig
}
/** Kind 447 self-update (non-empty) or token request (empty `entries`). */
export const tokenUpdateRumor = ({ pubkey, entries }) => rumorOf(KIND_TOKEN_UPDATE, pubkey, { v: PUSH_VERSION, tokens: entries })
export const tokenRemovalRumor = ({ pubkey, removals }) => rumorOf(KIND_TOKEN_REMOVAL, pubkey, { v: PUSH_VERSION, removals })
export const isPushPayload = (rumor) => [KIND_TOKEN_UPDATE, KIND_TOKEN_LIST, KIND_TOKEN_REMOVAL].includes(rumor?.kind)

/**
 * Per-group token record state (spec "Record state"): one record per (member, leaf,
 * platform, server), latest (owner_ts, digest) wins, durable tombstones. Serializable
 * via toJSON()/fromJSON so the relay can persist it.
 */
export class PushRecords {
  constructor(state = {}) {
    this.records = state.records ?? {} // key -> { entry, stamp }
    this.tombstones = state.tombstones ?? {} // key -> stamp
  }
  static key(e) {
    return `${e.member_id_hex}:${e.leaf_index}:${e.platform}:${e.server_pubkey_hex}`
  }
  static greater(a, b) {
    if (!b) return true
    return a.ts !== b.ts ? a.ts > b.ts : a.digest > b.digest
  }
  stampOf(key) {
    const r = this.records[key]?.stamp
    const t = this.tombstones[key]
    if (!r) return t
    if (!t) return r
    return PushRecords.greater(r, t) ? r : t
  }
  /**
   * Apply one decoded kind 447/448/449 rumor. `members` = current member pubkeys.
   * Returns { applied, dropped: [reason…] }. Advisory: never throws on bad data.
   */
  apply(rumor, { groupIdHex, members, now = Date.now() }) {
    const out = { applied: 0, dropped: [] }
    let content
    try {
      content = JSON.parse(rumor.content)
    } catch {
      out.dropped.push("content is not JSON")
      return out
    }
    if (content?.v !== PUSH_VERSION) {
      out.dropped.push("wrong version")
      return out
    }
    const removal = rumor.kind === KIND_TOKEN_REMOVAL
    const list = removal ? content.removals ?? [] : content.tokens ?? []
    if (!Array.isArray(list) || list.length > MAX_ENTRIES) {
      out.dropped.push("entry array invalid")
      return out
    }
    for (const e of list) {
      const bad = checkEntry(e, groupIdHex, { removal, now })
      if (bad) {
        out.dropped.push(bad)
        continue
      }
      if (!members.has(e.member_id_hex)) {
        out.dropped.push("not a current member")
        continue
      }
      const key = PushRecords.key(e)
      const stamp = { ts: e.owner_ts, digest: recordDigest(e, groupIdHex, { removal }) }
      if (!PushRecords.greater(stamp, this.stampOf(key))) {
        out.dropped.push("stale")
        continue
      }
      if (removal) {
        delete this.records[key]
        this.tombstones[key] = stamp
      } else {
        this.records[key] = { entry: e, stamp }
        delete this.tombstones[key]
      }
      out.applied++
    }
    return out
  }
  /** A removed leaf takes its records and tombstones with it. */
  dropLeaf(memberIdHex, leafIndex) {
    const prefix = `${memberIdHex}:${leafIndex}:`
    for (const k of Object.keys(this.records)) if (k.startsWith(prefix)) delete this.records[k]
    for (const k of Object.keys(this.tombstones)) if (k.startsWith(prefix)) delete this.tombstones[k]
  }
  /** Active entries, optionally excluding one member (the sender never wakes itself). */
  active({ excludeMember } = {}) {
    return Object.values(this.records).map((r) => r.entry).filter((e) => e.member_id_hex !== excludeMember)
  }
  toJSON() {
    return { records: this.records, tombstones: this.tombstones }
  }
}

// --- kind 446 trigger -------------------------------------------------------------------
/**
 * Gift-wrapped kind 446 triggers for the given entries, one per notification server
 * (rumor + seal by a FRESH ephemeral key, wrap by another — NIP-59 via nostr-tools).
 * `padding` random 1084-byte chunks are appended per trigger (spec "Padding and
 * batching"): besides hiding the real count, they make each trigger's content hash
 * unique — the server dedups on that hash, and a record's EncryptedToken never changes,
 * so without padding a second message within the server's retention window would not
 * wake the device. Returns [{ serverPubkeyHex, relays, event }]; relays = relay hints.
 */
export function buildTriggers(entries, { padding = 0 } = {}) {
  if (padding < 0 || padding >= MAX_ENTRIES) throw new Error("padding must be 0..31")
  const byServer = new Map()
  for (const e of entries) {
    const g = byServer.get(e.server_pubkey_hex) ?? { tokens: [], relays: new Set() }
    g.tokens.push(fromBase64(e.encrypted_token))
    if (relayHintOf(e)) g.relays.add(relayHintOf(e))
    byServer.set(e.server_pubkey_hex, g)
  }
  const out = []
  for (const [server, g] of byServer) {
    const per = MAX_ENTRIES - padding
    for (let i = 0; i < g.tokens.length; i += per) {
      const chunk = [...g.tokens.slice(i, i + per), ...Array.from({ length: padding }, () => randomBytes(ENCRYPTED_SIZE))]
      const content = new Uint8Array(chunk.length * ENCRYPTED_SIZE)
      chunk.forEach((t, k) => content.set(t, k * ENCRYPTED_SIZE))
      const rumor = { kind: KIND_TRIGGER, created_at: Math.floor(Date.now() / 1000), tags: [["v", PUSH_VERSION]], content: toBase64(content) }
      out.push({ serverPubkeyHex: server, relays: [...g.relays], event: wrapEvent(rumor, generateSecretKey(), server) })
    }
  }
  return out
}
