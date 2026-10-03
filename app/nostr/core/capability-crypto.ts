/**
 * NIP-04 / NIP-44 capability crypto (Story 3.6 / AD-5 / AD-6).
 *
 * These are the `nip04_*` / `nip44_*` CAPABILITY methods (FR-15) — distinct from AD-10's
 * transport respond-in-kind (owned by nip46-codec.ts). They perform encryption/decryption for
 * a connected client's request, behind a fresh approval.
 *
 * AD-6 injection rule: EVERY IV / nonce is drawn EXPLICITLY from the native CSPRNG
 * (react-native-quick-crypto via the injected `randomBytes` port) — NEVER a library-default RNG
 * (which reaches the absent global.crypto and throws). Because nostr-tools `nip04.encrypt` uses
 * a hardcoded/non-injectable IV, NIP-04 encryption is REIMPLEMENTED here (~15 lines) from
 * `@noble/ciphers` AES-CBC primitives with the 16-byte IV injected. `nip04.decrypt` and
 * `nip44.decrypt` carry no RNG and reuse nostr-tools directly.
 *
 * Exactly ONE noble copy on the signer path (AD-5, pinned per Story 1.1) — no second crypto
 * path beyond this mandated NIP-04 reimplementation. AD-1: core is UI-free.
 */
import { cbc } from "@noble/ciphers/aes.js"
import { secp256k1 } from "@noble/curves/secp256k1.js"
import { hexToBytes } from "@noble/hashes/utils.js"
import { base64 } from "@scure/base"
import * as nip04ref from "nostr-tools/nip04"
import * as nip44 from "nostr-tools/nip44"

import { secureRandomBytes } from "./keygen"

/** Injected entropy port (defaults to the native CSPRNG). Enables spy tests. */
export interface EntropyPort {
  randomBytes: (size: number) => Uint8Array
}

const defaultEntropy: EntropyPort = { randomBytes: secureRandomBytes }

const utf8Encoder = new TextEncoder()

const toBytes = (secretKey: string | Uint8Array): Uint8Array =>
  typeof secretKey === "string" ? hexToBytes(secretKey) : secretKey

/** NIP-04 shared key: normalized X of the ECDH secret (bytes 1..33), per the NIP-04 spec. */
const nip04SharedKey = (secretKey: Uint8Array, pubkeyHex: string): Uint8Array =>
  secp256k1.getSharedSecret(secretKey, hexToBytes("02" + pubkeyHex)).slice(1, 33)

/**
 * NIP-04 encrypt, reimplemented from @noble/ciphers AES-CBC with the 16-byte IV injected
 * EXPLICITLY from quick-crypto (AD-6). Output envelope is spec-conformant: `<ct>?iv=<iv>`
 * (base64), interoperable with reference NIP-04 implementations. `entropy` is injectable for
 * tests (default = native CSPRNG).
 */
export const nip04Encrypt = (
  secretKey: string | Uint8Array,
  pubkeyHex: string,
  plaintext: string,
  entropy: EntropyPort = defaultEntropy,
  // eslint-disable-next-line max-params
): string => {
  const key = nip04SharedKey(toBytes(secretKey), pubkeyHex)
  const iv = entropy.randomBytes(16) // explicit IV injection (never a default RNG)
  const ciphertext = cbc(key, iv).encrypt(utf8Encoder.encode(plaintext))
  return `${base64.encode(ciphertext)}?iv=${base64.encode(iv)}`
}

/** NIP-04 decrypt — no RNG on decrypt, so the nostr-tools reference is reused. */
export const nip04Decrypt = (
  secretKey: string | Uint8Array,
  pubkeyHex: string,
  ciphertext: string,
): string => nip04ref.decrypt(toBytes(secretKey), pubkeyHex, ciphertext)

/**
 * NIP-44 encrypt with the 32-byte nonce injected EXPLICITLY from quick-crypto (AD-6) — never
 * nostr-tools' default RNG path. `entropy` is injectable for tests (default = native CSPRNG).
 */
export const nip44Encrypt = (
  secretKey: string | Uint8Array,
  pubkeyHex: string,
  plaintext: string,
  entropy: EntropyPort = defaultEntropy,
  // eslint-disable-next-line max-params
): string => {
  const conversationKey = nip44.getConversationKey(toBytes(secretKey), pubkeyHex)
  const nonce = entropy.randomBytes(32) // explicit nonce injection
  return nip44.encrypt(plaintext, conversationKey, nonce)
}

/** NIP-44 decrypt — no RNG on decrypt, reuse nostr-tools. */
export const nip44Decrypt = (
  secretKey: string | Uint8Array,
  pubkeyHex: string,
  payload: string,
): string => {
  const conversationKey = nip44.getConversationKey(toBytes(secretKey), pubkeyHex)
  return nip44.decrypt(payload, conversationKey)
}
