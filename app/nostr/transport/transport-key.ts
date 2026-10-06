/**
 * Transport keypair provisioning (Story 1.3 / AD-4).
 *
 * The device-local remote-signer transport keypair (used for kind-24133 transport
 * encryption in Epic 3) is NOT an identity and is OUTSIDE the NostrSigner seam. It is:
 *  - generated ONCE on first signer enable, via the Story 1.2 CSPRNG keygen path (AD-6);
 *  - DISTINCT from the identity key;
 *  - stored under keychain `nostr.transportKey` (AFTER_FIRST_UNLOCK), device-local;
 *  - NEVER backed up, NEVER rotated in v1 (identity replacement / FR-6 does not touch it;
 *    connections do not survive a device restore).
 *
 * There is deliberately NO rotation entrypoint. AD-1: no React/UI imports.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"

import { generateNostrKey } from "../core/keygen"
import { NOSTR_TRANSPORT_SERVICE, readSecret, writeSecret } from "../core/keystore"

/**
 * Ensure a transport keypair exists, generating and persisting one on first call.
 * Returns the transport x-only public key (hex). Idempotent: an existing key is never
 * overwritten (no rotation).
 */
export const provisionTransportKey = async (): Promise<string> => {
  const existing = await readSecret(NOSTR_TRANSPORT_SERVICE)
  if (existing) {
    return bytesToHex(schnorr.getPublicKey(hexToBytes(existing)))
  }
  const { privKeyHex } = generateNostrKey()
  await writeSecret(NOSTR_TRANSPORT_SERVICE, privKeyHex)
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privKeyHex)))
}

/** Read the transport x-only public key, or null if not yet provisioned. */
export const readTransportPublicKey = async (): Promise<string | null> => {
  const secret = await readSecret(NOSTR_TRANSPORT_SERVICE)
  if (!secret) return null
  return bytesToHex(schnorr.getPublicKey(hexToBytes(secret)))
}
