/**
 * C3 — NIP-06 nsec derivation from a self-custodial account's Spark mnemonic.
 *
 * The golden vector below is the standard "abandon … about" mnemonic at m/44'/1237'/0'/0/0
 * (cross-checked against the official BIP-32 test-vector-1 semantics of @scure/bip32).
 */
import { schnorr } from "@noble/curves/secp256k1.js"

import {
  deriveNsecFromMnemonic,
  NOSTR_DERIVATION_PATH,
} from "@app/self-custodial/derive-nostr-key"

const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
const GOLDEN_PRIV = "5f29af3b9676180290e77a4efad265c4c2ff28a5302461f73597fda26bb25731"
const GOLDEN_PUB = "e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f"

describe("deriveNsecFromMnemonic (NIP-06)", () => {
  it("matches the published-style golden vector for the standard test mnemonic", () => {
    expect(deriveNsecFromMnemonic(TEST_MNEMONIC)).toEqual({
      privKeyHex: GOLDEN_PRIV,
      pubKeyHex: GOLDEN_PUB,
    })
  })

  it("is deterministic", () => {
    expect(deriveNsecFromMnemonic(TEST_MNEMONIC)).toEqual(
      deriveNsecFromMnemonic(TEST_MNEMONIC),
    )
  })

  it("derives the x-only pubkey consistent with BIP-340 over the private scalar", () => {
    const { privKeyHex, pubKeyHex } = deriveNsecFromMnemonic(TEST_MNEMONIC)
    expect(Buffer.from(pubKeyHex, "hex").toString("hex")).toBe(
      Buffer.from(schnorr.getPublicKey(Buffer.from(privKeyHex, "hex"))).toString("hex"),
    )
  })

  it("produces distinct keys for distinct mnemonics", () => {
    const other = deriveNsecFromMnemonic(
      "legal winner thank year wave sausage worth useful legal winner thank yellow",
    )
    expect(other.privKeyHex).not.toBe(GOLDEN_PRIV)
    expect(other.pubKeyHex).not.toBe(GOLDEN_PUB)
  })

  it("uses the NIP-06 path constant", () => {
    expect(NOSTR_DERIVATION_PATH).toBe("m/44'/1237'/0'/0/0")
  })
})
