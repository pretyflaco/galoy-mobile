/**
 * Hermes text-encoding polyfill (side-effect module).
 *
 * Hermes (the RN JS engine, hermesEnabled=true) does NOT provide the TextEncoder/TextDecoder
 * globals that Node and browsers do. The nostr-signer feature and its crypto dependencies
 * reference them — @scure/base (bech32, used by nip19 npub/nsec), @noble/hashes (utf8), and
 * app/nostr/core/capability-crypto.ts (a module-top-level `new TextEncoder()`). Some of these
 * run at module-evaluation time, so the globals must exist before ANY of those modules load.
 *
 * This module is imported FIRST in index.js. Because ES import evaluation is ordered, importing
 * this before "@react-native-firebase/app" / "./app/app" guarantees the globals are installed
 * ahead of every consumer. Without it the app throws
 * "ReferenceError: Property 'TextDecoder' doesn't exist" on Hermes and crashes after splash.
 *
 * Idempotent + non-clobbering: only assigns when the global is absent (a future RN/Hermes that
 * ships these natively is left untouched).
 */
// eslint-disable-next-line no-restricted-imports
import { TextEncoder, TextDecoder } from "text-encoding"

const globalScope = global as unknown as {
  TextEncoder?: unknown
  TextDecoder?: unknown
}

if (typeof globalScope.TextEncoder === "undefined") {
  globalScope.TextEncoder = TextEncoder
}
if (typeof globalScope.TextDecoder === "undefined") {
  globalScope.TextDecoder = TextDecoder
}
