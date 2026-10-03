// POC EventSigner (02-poc-plan.md Addendum A2): a throwaway key held in memory.
// Implements the applesauce-core EventSigner interface. nip44 is typed optional
// there but REQUIRED in practice: kind-1059 gift wraps and kind-13 seals are
// decrypted via signer.nip44 (verified 2026-09-27 against
// applesauce-core/dist/helpers/encrypted-content.js, which maps kinds 13/1059 -> "nip44").
// The Blink form (M6) delegates to the fork's LocalNsecSigner instead.
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure"
import { v2 as nip44 } from "nostr-tools/nip44"

export class TestEventSigner {
  #secretKey

  /** @param {Uint8Array} [secretKey] throwaway key; generated when omitted */
  constructor(secretKey = generateSecretKey()) {
    this.#secretKey = secretKey
    this.publicKey = getPublicKey(secretKey)
  }

  getPublicKey() {
    return this.publicKey
  }

  /** Raw secret key bytes — exposed only so the POC app can persist the throwaway
   *  identity across restarts. The Blink form (M6) never exposes key material. */
  get secretKeyBytes() {
    return this.#secretKey
  }

  signEvent(draft) {
    return finalizeEvent(draft, this.#secretKey)
  }

  nip44 = {
    encrypt: (pubkey, plaintext) =>
      nip44.encrypt(plaintext, nip44.utils.getConversationKey(this.#secretKey, pubkey)),
    decrypt: (pubkey, ciphertext) =>
      nip44.decrypt(ciphertext, nip44.utils.getConversationKey(this.#secretKey, pubkey)),
  }
}
