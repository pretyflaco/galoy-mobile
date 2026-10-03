/**
 * Hermes `crypto.getRandomValues` polyfill (side-effect module).
 *
 * Hermes (hermesEnabled=true) does NOT provide the Web Crypto `crypto.getRandomValues` global
 * that Node and browsers do. nostr-tools' `finalizeEvent` signs via @noble/curves' schnorr, which
 * reads `globalThis.crypto.getRandomValues` for the signature's auxiliary randomness. Without it
 * EVERY event signature throws "crypto.getRandomValues must be defined" — so the NIP-46
 * connect-ack (and every signed response) fails to publish and the BTCPay plugin times out
 * (observed on-device via `adb logcat`: publish-fail ×5 → connect-ack-unconfirmed).
 *
 * We back it with react-native-quick-crypto's native CSPRNG (the same sanctioned RNG the signer's
 * keygen already uses, AD-6) rather than a JS-Math fallback. This runs FIRST in index.js so the
 * global exists before any nostr-tools / @noble module loads.
 *
 * Idempotent + non-clobbering: only installs when `crypto.getRandomValues` is absent (a future
 * Hermes that ships Web Crypto natively, or an already-installed polyfill, is left untouched).
 */
import QuickCrypto from "react-native-quick-crypto"

type CryptoLike = { getRandomValues?: unknown }
const globalScope = global as unknown as { crypto?: CryptoLike }

if (typeof globalScope.crypto === "undefined") {
  globalScope.crypto = {} as CryptoLike
}

if (typeof globalScope.crypto.getRandomValues === "undefined") {
  // Web Crypto contract: fill `array` in place and return the SAME reference. quick-crypto's
  // native getRandomValues does exactly this; we pass the array through untyped to satisfy both
  // the noble consumer (any TypedArray) and quick-crypto's narrower union.
  const fill = (array: ArrayBufferView): ArrayBufferView =>
    QuickCrypto.getRandomValues(array as never) as ArrayBufferView
  globalScope.crypto.getRandomValues = fill
}
