/**
 * The support chat's OWN key (operator decision 2026-10-03, M19): one random secp256k1 key
 * per DEVICE, used only for Blink Support conversations — not the user's Nostr identity.
 *  - no "create a Nostr identity first" gate, and support works before an account exists
 *    (Get started → Contact support);
 *  - support cannot link the chat to the user's public npub;
 *  - trade-off: a new device is a new support key (the history was device-local anyway).
 *
 * The secret lives in the keychain (`supportchat.key.device`,
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY — never in an iCloud/iTunes backup, M20/Hermes
 * #3) and never leaves this module: the signer
 * below is the only thing that uses it. Every random value is drawn explicitly from the
 * native CSPRNG (AD-6): Schnorr auxRand and the NIP-44 nonce, never a library default.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { getEventHash } from "nostr-tools/pure"

import { nip44Decrypt, nip44Encrypt } from "@app/nostr/core/capability-crypto"
import { isValidSecpScalar, secureRandomBytes } from "@app/nostr/core/keygen"
import {
  readSecretThisDeviceOnly,
  writeSecretThisDeviceOnly,
} from "@app/nostr/core/keystore"
import type { EventTemplate, SignedEvent } from "@app/nostr/core/signer"

import type { BlinkEventSigner } from "./blink-signer"

/** The storage scope of the device's support conversations (stores, meta, history). */
export const SUPPORT_SCOPE = "device"
const KEY_SERVICE = "supportchat.key.device"

let loading: Promise<Uint8Array> | null = null

/** The device's support key: read from the keychain, or created once on first use. */
export const loadOrCreateSupportKey = (): Promise<Uint8Array> => {
  if (!loading) {
    loading = (async () => {
      const existing = await readSecretThisDeviceOnly(KEY_SERVICE)
      if (existing) {
        const sk = hexToBytes(existing)
        if (isValidSecpScalar(sk)) return sk
        throw new Error("support chat: the stored support key is invalid")
      }
      let sk = secureRandomBytes(32)
      while (!isValidSecpScalar(sk)) sk = secureRandomBytes(32) // p ≈ 2^-128
      await writeSecretThisDeviceOnly(KEY_SERVICE, bytesToHex(sk))
      return sk
    })()
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/** The Marmot EventSigner for support conversations, over the device's support key. */
export const createSupportSigner = (sk: Uint8Array): BlinkEventSigner => {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk))
  return {
    getPublicKey: async () => pubkey,
    signEvent: async (template: EventTemplate): Promise<SignedEvent> => {
      const unsigned = { ...template, pubkey }
      const id = getEventHash(unsigned)
      const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk, secureRandomBytes(32)))
      return { ...unsigned, id, sig }
    },
    nip44: {
      encrypt: async (peer, plaintext) => nip44Encrypt(sk, peer, plaintext),
      decrypt: async (peer, ciphertext) => nip44Decrypt(sk, peer, ciphertext),
    },
  }
}
