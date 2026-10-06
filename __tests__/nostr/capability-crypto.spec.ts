/**
 * Story 3.6 Task 2 — capability crypto: NIP-04 reimpl with injected IV + NIP-44 with injected
 * nonce (AC #2, AD-5/AD-6). Every IV/nonce is drawn EXPLICITLY from quick-crypto — never a
 * library-default RNG (which reaches the absent global.crypto and throws).
 *
 * The deterministic quick-crypto mock returns Buffer.alloc(size, 0xab), so we assert the
 * INJECTION PATH (a spy over the injected randomBytes is consulted) rather than raw entropy.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import * as nip04ref from "nostr-tools/nip04"

import {
  nip04Encrypt,
  nip04Decrypt,
  nip44Encrypt,
  nip44Decrypt,
} from "../../app/nostr/core/capability-crypto"

const aliceSk = new Uint8Array(32).fill(3)
const aliceSkHex = bytesToHex(aliceSk)
const bobSk = new Uint8Array(32).fill(7)
const bobPubHex = bytesToHex(schnorr.getPublicKey(bobSk))
const alicePubHex = bytesToHex(schnorr.getPublicKey(aliceSk))

describe("NIP-04 IV injection (AC #2, AD-6)", () => {
  it("nip04Encrypt draws its 16-byte IV from the injected randomBytes port (spy)", () => {
    const randomBytes = jest.fn((n: number) => new Uint8Array(n).fill(0x11))
    const cipher = nip04Encrypt(aliceSkHex, bobPubHex, "hello", { randomBytes })
    expect(randomBytes).toHaveBeenCalledWith(16) // explicit IV injection
    expect(cipher).toContain("?iv=") // NIP-04 envelope marker
  })

  it("its ciphertext round-trips with the nostr-tools reference NIP-04 decrypt", () => {
    const randomBytes = (n: number) => new Uint8Array(n).fill(0x22)
    const cipher = nip04Encrypt(aliceSkHex, bobPubHex, "secret msg", { randomBytes })
    // Bob decrypts with the reference implementation → plaintext equality.
    const plaintext = nip04ref.decrypt(bobSk, alicePubHex, cipher)
    expect(plaintext).toBe("secret msg")
  })

  it("nip04Decrypt reads a nostr-tools-reference-encrypted payload (both directions)", () => {
    // Bob encrypts to Alice with the reference impl; our decrypt recovers it.
    const cipher = nip04ref.encrypt(bobSk, alicePubHex, "from bob")
    const plaintext = nip04Decrypt(aliceSkHex, bobPubHex, cipher)
    expect(plaintext).toBe("from bob")
  })
})

describe("NIP-44 nonce injection (AC #2, AD-6)", () => {
  it("nip44Encrypt draws its 32-byte nonce from the injected randomBytes port (spy)", () => {
    const randomBytes = jest.fn((n: number) => new Uint8Array(n).fill(0x33))
    nip44Encrypt(aliceSkHex, bobPubHex, "hi", { randomBytes })
    expect(randomBytes).toHaveBeenCalledWith(32) // explicit nonce injection
  })

  it("round-trips both directions vs the app's own NIP-44 (encrypt-here/decrypt-here)", () => {
    const randomBytes = (n: number) => new Uint8Array(n).fill(0x44)
    // Alice encrypts to Bob; Bob decrypts with the same capability function.
    const cipher = nip44Encrypt(aliceSkHex, bobPubHex, "payload", { randomBytes })
    const plaintext = nip44Decrypt(bytesToHex(bobSk), alicePubHex, cipher)
    expect(plaintext).toBe("payload")
  })
})
