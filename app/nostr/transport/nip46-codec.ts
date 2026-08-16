/**
 * NIP-46 kind-24133 codec (Story 3.2 / AD-4 / AD-5 / AD-10).
 *
 * Encodes/decodes the NIP-46 request/response envelope carried in kind-24133 event
 * `content`. Transport encryption uses the DEVICE-LOCAL transport keypair (AD-4), distinct
 * from the identity key — the identity nsec is never touched here.
 *
 * Respond-in-kind (AD-10): `decodeRequest` detects whether the inbound payload is NIP-44 or
 * legacy NIP-04 and returns the detected `scheme`; `encodeResponse` replies in the SAME
 * scheme. The signer NEVER initiates or advertises NIP-04 transport — a signer-INITIATED
 * message is always NIP-44. (This transport respond-in-kind is DISTINCT from the
 * `nip04_*`/`nip44_*` capability methods of FR-15, which land in Story 3.6.)
 *
 * AD-1: transport is UI-free. AD-6: no randomness is consumed here on the decode path;
 * NIP-44 encrypt draws its nonce from nostr-tools' injected default only for the transport
 * envelope — the capability-method crypto (3.6) injects explicitly. Metadata-only logging:
 * this module never logs plaintext, ciphertext, or keys.
 */
import { hexToBytes } from "@noble/hashes/utils.js"
import { finalizeEvent, type Event } from "nostr-tools/pure"
import * as nip04 from "nostr-tools/nip04"
import * as nip44 from "nostr-tools/nip44"

/** The NIP-46 remote-signing event kind. */
export const NIP46_KIND = 24133

/** The two transport encryption schemes the signer must interoperate with (AD-10). */
export type TransportScheme = "nip04" | "nip44"

/** A decoded NIP-46 request body (method names + ids verbatim from the wire). */
export interface Nip46Request {
  id: string
  method: string
  params: string[]
}

/** A NIP-46 response body — exactly one of `result` / `error` per the spec. */
export interface Nip46Response {
  id: string
  result?: string
  error?: string
}

export interface DecodedRequest {
  clientPubkey: string
  scheme: TransportScheme
  request: Nip46Request
}

export interface EncodeResponseContext {
  scheme: TransportScheme
  clientPubkey: string
  /** The device-local transport secret (hex or bytes) used to encrypt the reply (AD-4). */
  transportSk: string | Uint8Array
}

/**
 * Detect the transport scheme of a ciphertext. Legacy NIP-04 payloads carry a `?iv=`
 * marker (`<base64>?iv=<base64>`); NIP-44 payloads do not. Detection is structural — never a
 * guess based on which key happens to decrypt.
 */
export const detectScheme = (ciphertext: string): TransportScheme =>
  ciphertext.includes("?iv=") ? "nip04" : "nip44"

const toBytes = (sk: string | Uint8Array): Uint8Array =>
  typeof sk === "string" ? hexToBytes(sk) : sk

/**
 * Decode an inbound kind-24133 request event using the device-local transport secret.
 * Detects the payload scheme and decrypts with the matching primitive, returning the
 * verbatim `{id, method, params}` plus the claimed author `clientPubkey` and the scheme (so
 * the response can be sent in kind). Assumes the event's BIP-340 signature was already
 * verified upstream (pipeline verify-before-decrypt stage) — decode never runs on an
 * unverified event.
 */
export const decodeRequest = (
  event: Event,
  transportSk: string | Uint8Array,
): DecodedRequest => {
  const clientPubkey = event.pubkey
  const scheme = detectScheme(event.content)
  const skBytes = toBytes(transportSk)
  const json =
    scheme === "nip04"
      ? nip04.decrypt(skBytes, clientPubkey, event.content)
      : nip44.decrypt(event.content, nip44.getConversationKey(skBytes, clientPubkey))
  const parsed = JSON.parse(json) as Partial<Nip46Request>
  return {
    clientPubkey,
    scheme,
    request: {
      id: String(parsed.id ?? ""),
      method: String(parsed.method ?? ""),
      params: Array.isArray(parsed.params) ? parsed.params.map(String) : [],
    },
  }
}

/**
 * Encode a NIP-46 response as a signed kind-24133 event addressed back to the client,
 * encrypted in the SAME scheme the request arrived in (respond-in-kind, AD-10). The event is
 * finalized with the device-local transport key (AD-4).
 */
export const encodeResponse = (
  response: Nip46Response,
  context: EncodeResponseContext,
): Event => {
  const { scheme, clientPubkey, transportSk } = context
  const skBytes = toBytes(transportSk)
  const json = JSON.stringify(response)
  const content =
    scheme === "nip04"
      ? nip04.encrypt(skBytes, clientPubkey, json)
      : nip44.encrypt(json, nip44.getConversationKey(skBytes, clientPubkey))
  return finalizeEvent(
    {
      kind: NIP46_KIND,
      // eslint-disable-next-line camelcase
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", clientPubkey]],
      content,
    },
    skBytes,
  )
}
