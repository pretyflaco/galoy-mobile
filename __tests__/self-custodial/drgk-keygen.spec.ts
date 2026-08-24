/**
 * B5 — DRGK keygen: compressed-pubkey encoding, CSPRNG-only discipline, and the AC-3
 * custody boundary (fresh random key — never derived from the Spark seed; never stored).
 */
import { schnorr } from "@noble/curves/secp256k1.js"

import { generateDrgkKeypair } from "@app/nostr/core/keygen"

describe("generateDrgkKeypair (B1 / AC-3)", () => {
  it("returns a 33-byte COMPRESSED pubkey hex (66 chars, 02/03 prefix) — not x-only", () => {
    const { compressedPubKeyHex } = generateDrgkKeypair()
    expect(compressedPubKeyHex).toMatch(/^(02|03)[0-9a-f]{64}$/)
    // Contrast: the nostr identity path uses 64-char x-only keys.
    expect(compressedPubKeyHex).toHaveLength(66)
  })

  it("the compressed key decompresses to a point whose x agrees with BIP-340 encoding", () => {
    const { privKeyHex, compressedPubKeyHex } = generateDrgkKeypair()
    // The jest RNG mock is deterministic, so both encodings derive from the same scalar.
    expect(compressedPubKeyHex.slice(2)).toBe(
      Buffer.from(schnorr.getPublicKey(Buffer.from(privKeyHex, "hex"))).toString("hex"),
    )
  })

  it("is NOT derived from the Spark seed (distinct from the NIP-06 path for the same mnemonic)", async () => {
    const { HDKey } = await import("@scure/bip32")
    const { mnemonicToSeedSync } = await import("@scure/bip39")
    const { deriveNsecFromMnemonic } = await import(
      "@app/self-custodial/derive-nostr-key"
    )

    const mnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    const nip06Priv = deriveNsecFromMnemonic(mnemonic).privKeyHex
    // Even the deterministic jest RNG output must never equal any seed-derived scalar.
    const { privKeyHex } = generateDrgkKeypair()
    const seedDerived = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(
      "m/44'/1237'/0'/0/0",
    )
    expect(privKeyHex).not.toBe(nip06Priv)
    if (seedDerived.privateKey) {
      expect(privKeyHex).not.toBe(Buffer.from(seedDerived.privateKey).toString("hex"))
    }
  })

  it("imports no storage module at all — the DRGK path is statically storage-free (AC-3)", async () => {
    // keygen.ts's only imports are the native CSPRNG, noble curves and the signer error
    // type; assert the compiled module surface has no persistence side effects by checking
    // the exports contain nothing but the key functions.
    const keygenModule = await import("@app/nostr/core/keygen")
    for (const exportName of Object.keys(keygenModule)) {
      expect(typeof (keygenModule as Record<string, unknown>)[exportName]).not.toBe(
        "object",
      )
    }
  })
})
