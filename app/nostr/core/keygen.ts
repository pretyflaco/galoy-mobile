/**
 * Fail-closed nostr key generation (Story 1.2 / AD-6 / NFR-4).
 *
 * All key material comes ONLY from the platform CSPRNG (react-native-quick-crypto
 * native randomBytes), is validated against the secp256k1 scalar range, and is
 * injected EXPLICITLY into @noble/curves. This module is the sole keygen entry.
 *
 * Hard rules (enforced here + by the ESLint core-keygen boundary):
 *  - never call noble's no-arg generator (`secp256k1.utils.randomSecretKey()`),
 *    webcrypto, or any library-default RNG;
 *  - never polyfill `global.crypto`;
 *  - never use `Math.random` / any JS PRNG on the key path;
 *  - if the native RNG is unavailable or yields unusable output, THROW and create
 *    no key (fail-closed) — RNG unavailability must never become a silent key.
 *
 * AD-1: core is UI-free — no React / React Native imports.
 */
// AD-6: react-native-quick-crypto is the native CSPRNG (not UI) and is the sanctioned
// entropy source on the signer path — the one allowed react-native-* import in core.
// eslint-disable-next-line no-restricted-imports
import Crypto from "react-native-quick-crypto"
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js"

import { makeSignerError, type SignerError } from "./signer"

/** Bounded redraw budget for out-of-range scalars before we fail closed. */
const MAX_SCALAR_DRAWS = 8

/** Number of draws the release sanity check compares for non-constant output. */
const RNG_SANITY_DRAWS = 4

const toHexLower = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex")

/** Draw exactly `size` bytes from the native CSPRNG; throw (fail-closed) on any failure. */
const nativeRandomBytes = (size: number): Uint8Array => {
  let out: Uint8Array | Buffer
  try {
    out = Crypto.randomBytes(size)
  } catch (cause) {
    throw makeSignerError("unavailable", "native secure RNG unavailable", cause)
  }
  if (!out || out.length !== size) {
    throw makeSignerError("unavailable", "native secure RNG returned unusable output")
  }
  return Uint8Array.from(out)
}

/**
 * The single source of consumed randomness on the signer path (AC-5). NIP-44 nonces,
 * NIP-04 IVs, and Schnorr `auxRand` are all drawn HERE, explicitly, from the native
 * CSPRNG — never from a library-default RNG (which would reach the absent global.crypto
 * and fail). Callers must pass the result explicitly into the crypto primitive.
 */
export const secureRandomBytes = (size: number): Uint8Array => nativeRandomBytes(size)

/** A valid secp256k1 private scalar `d` satisfies `0 < d < n`. */
export const isValidSecpScalar = (bytes: Uint8Array): boolean => {
  if (bytes.length !== 32) return false
  return secp256k1.utils.isValidSecretKey(bytes)
}

/**
 * Release-configuration RNG sanity check (AC-4). Runs BEFORE any key material is
 * generated. Draws multiple times and asserts the output is non-constant across draws
 * — the real native RNG varies; the deterministic Jest mock (Buffer.alloc(size,0xab))
 * does not. Blocks keygen (throws) if the source looks deterministic.
 */
export const assertSecureRng = (): void => {
  const draws: string[] = []
  for (let i = 0; i < RNG_SANITY_DRAWS; i += 1) {
    draws.push(toHexLower(nativeRandomBytes(32)))
  }
  const allIdentical = draws.every((d) => d === draws[0])
  if (allIdentical) {
    throw makeSignerError(
      "unavailable",
      "RNG sanity check failed: source produced constant output across draws " +
        "(deterministic RNG / test mock must never reach a release build)",
    )
  }
}

/**
 * Generate a nostr identity key. Draws 32 bytes from the native CSPRNG, validates the
 * secp256k1 scalar range (redrawing from the SAME source on rejection), and derives the
 * compressed public key by injecting the bytes explicitly into noble. Fail-closed.
 *
 * Invoked ONLY from a user-initiated ceremony/import (FR-3 / SM-C1) — never auto-generated.
 */
export const generateNostrKey = (): { privKeyHex: string; pubKeyHex: string } => {
  for (let attempt = 0; attempt < MAX_SCALAR_DRAWS; attempt += 1) {
    const bytes = nativeRandomBytes(32)
    if (isValidSecpScalar(bytes)) {
      // Explicit injection — NEVER secp256k1.utils.randomSecretKey(). X-only (BIP-340,
      // 32-byte) pubkey: Nostr's canonical form. secp256k1.getPublicKey() returns the
      // 33-byte COMPRESSED key — encoding that as npub produced a bogus address that
      // mismatched the identity hub (hub/import/signing all use schnorr x-only).
      const pubKey = schnorr.getPublicKey(bytes)
      return { privKeyHex: toHexLower(bytes), pubKeyHex: toHexLower(pubKey) }
    }
  }
  const err: SignerError = makeSignerError(
    "unavailable",
    `no valid secp256k1 scalar after ${MAX_SCALAR_DRAWS} draws (never weaken the RNG source)`,
  )
  throw err
}
