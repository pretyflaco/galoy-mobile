/**
 * Story 3.6 Task 1 — the four capability methods on the NostrSigner seam (FR-15).
 *
 * nip04Encrypt/nip04Decrypt/nip44Encrypt/nip44Decrypt are implemented in LocalNsecSigner (the
 * nsec stays confined there) and round-trip against reference NIP-04 / NIP-44 implementations
 * (encrypt-here/decrypt-there and back). No longer throws "not implemented until 3.6".
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import * as nip04ref from "nostr-tools/nip04"
import * as nip44ref from "nostr-tools/nip44"

import { createLocalNsecSigner } from "../../app/nostr/core/local-nsec-signer"

const userSk = new Uint8Array(32).fill(5)
const userSkHex = bytesToHex(userSk)
const userPubHex = bytesToHex(schnorr.getPublicKey(userSk))

const peerSk = new Uint8Array(32).fill(8)
const peerSkHex = bytesToHex(peerSk)
const peerPubHex = bytesToHex(schnorr.getPublicKey(peerSk))

const signer = createLocalNsecSigner({ readNsecHex: async () => userSkHex })

describe("NIP-44 capability round-trip (AC #1)", () => {
  it("signer-encrypt → reference-decrypt recovers the plaintext", async () => {
    const cipher = await signer.nip44Encrypt(peerPubHex, "hello nip44")
    const ck = nip44ref.getConversationKey(peerSk, userPubHex)
    expect(nip44ref.decrypt(cipher, ck)).toBe("hello nip44")
  })

  it("reference-encrypt → signer-decrypt recovers the plaintext", async () => {
    const ck = nip44ref.getConversationKey(peerSk, userPubHex)
    const cipher = nip44ref.encrypt("from peer 44", ck)
    expect(await signer.nip44Decrypt(peerPubHex, cipher)).toBe("from peer 44")
  })
})

describe("NIP-04 capability round-trip (AC #1)", () => {
  it("signer-encrypt → reference-decrypt recovers the plaintext", async () => {
    const cipher = await signer.nip04Encrypt(peerPubHex, "hello nip04")
    expect(nip04ref.decrypt(peerSkHex, userPubHex, cipher)).toBe("hello nip04")
  })

  it("reference-encrypt → signer-decrypt recovers the plaintext", async () => {
    const cipher = nip04ref.encrypt(peerSkHex, userPubHex, "from peer 04")
    expect(await signer.nip04Decrypt(peerPubHex, cipher)).toBe("from peer 04")
  })
})

describe("capabilities descriptor", () => {
  it("no longer throws the 3.6 placeholder", async () => {
    await expect(signer.nip44Encrypt(peerPubHex, "x")).resolves.toBeTruthy()
    await expect(signer.nip04Encrypt(peerPubHex, "x")).resolves.toContain("?iv=")
  })
})
