/**
 * Derive a nostr identity key from a self-custodial account's Spark seed (NIP-06).
 *
 * The primary "new nsec" option for self-custodial accounts: the nostr identity is bound to
 * the wallet seed (m/44'/1237'/0'/0/0), so restoring the wallet restores the identity.
 *
 * Custody model — OPPOSITE of the DRGK path (grants/*): the nsec IS derived from the seed
 * here, by design. The two paths must never be conflated:
 *  - this module: nostr identity ← Spark seed (NIP-06, deterministic);
 *  - grants keygen: fresh CSPRNG key, never derived from or stored with the seed.
 *
 * Deterministic, not random: no RNG involvement, so the keygen fail-closed RNG rules do not
 * apply; the scalar range check from core/keygen does. The result is persisted through the
 * ordinary nostr keystore (`nostr.nsec.<accountKey>`) — this module itself never stores.
 */
import { HDKey } from "@scure/bip32"
import { mnemonicToSeedSync } from "@scure/bip39"
import { schnorr } from "@noble/curves/secp256k1.js"

import { isValidSecpScalar } from "@app/nostr/core/keygen"
import { makeSignerError } from "@app/nostr/core/signer"

/** NIP-06: nostr key derivation path from a BIP-39 seed. */
export const NOSTR_DERIVATION_PATH = "m/44'/1237'/0'/0/0"

const toHexLower = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex")

/**
 * Derive the NIP-06 nostr key from a BIP-39 mnemonic. Returns lowercase hex: the private
 * scalar and the BIP-340 x-only pubkey (same shape as generateNostrKey). Fail-closed on an
 * out-of-range scalar (astronomically improbable for HMAC-SHA512 output, but never weaken).
 */
export const deriveNsecFromMnemonic = (
  mnemonic: string,
): {
  privKeyHex: string
  pubKeyHex: string
} => {
  const seed = mnemonicToSeedSync(mnemonic)
  const derived = HDKey.fromMasterSeed(seed).derive(NOSTR_DERIVATION_PATH)
  const priv = derived.privateKey
  if (!priv || !isValidSecpScalar(priv)) {
    throw makeSignerError(
      "unavailable",
      "NIP-06 derivation produced an unusable secp256k1 scalar",
    )
  }
  return {
    privKeyHex: toHexLower(priv),
    pubKeyHex: toHexLower(schnorr.getPublicKey(priv)),
  }
}
