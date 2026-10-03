/**
 * Regression guard — Hermes TextEncoder/TextDecoder polyfill.
 *
 * Hermes (the on-device RN engine) has NO TextEncoder/TextDecoder globals, but the nostr-signer
 * and its crypto deps (@scure/base bech32 for npub/nsec, @noble/hashes utf8, capability-crypto's
 * top-level `new TextEncoder()`) reference them at module-load time. Missing them crashes the app
 * after splash with "ReferenceError: Property 'TextDecoder' doesn't exist".
 *
 * Node (where jest runs) HAS these globals, so a normal unit test can't reproduce the crash —
 * that gap is exactly why it slipped past 7859 green tests to the device. We therefore guard the
 * FIX rather than the crash:
 *   1. the text-encoding package provides working TextEncoder/TextDecoder (the impls the polyfill
 *      installs on Hermes);
 *   2. index.js imports the polyfill side-effect module BEFORE firebase/App, so a future refactor
 *      can't reorder it and silently re-crash on device.
 * We deliberately do NOT delete the real jest globals (jest's own runtime uses TextDecoder).
 */
import fs from "fs"
import path from "path"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TextEncoder: PolyEncoder, TextDecoder: PolyDecoder } = require("text-encoding")

describe("Hermes text-encoding polyfill (device regression guard)", () => {
  it("the text-encoding impls the polyfill installs actually round-trip utf8", () => {
    // These are the exact constructors app/polyfills/text-encoding.ts assigns to the globals.
    const bytes = new PolyEncoder().encode("npub-roundtrip-✓")
    expect(bytes.length).toBeGreaterThan(0)
    expect(new PolyDecoder().decode(bytes)).toBe("npub-roundtrip-✓")
  })

  it("the polyfill module is non-clobbering (only assigns when the global is absent)", () => {
    // Assert the guard shape in source: each assignment is gated on `typeof ... === "undefined"`.
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../app/polyfills/text-encoding.ts"),
      "utf8",
    )
    expect(src).toMatch(/typeof\s+globalScope\.TextEncoder\s*===\s*"undefined"/)
    expect(src).toMatch(/typeof\s+globalScope\.TextDecoder\s*===\s*"undefined"/)
  })

  it("index.js imports the polyfill BEFORE firebase/App (ordering can't regress)", () => {
    const indexSrc = fs.readFileSync(path.resolve(__dirname, "../../index.js"), "utf8")
    const polyfillIdx = indexSrc.indexOf("app/polyfills/text-encoding")
    const firebaseIdx = indexSrc.indexOf("@react-native-firebase/app")
    const appIdx = indexSrc.indexOf("./app/app")

    expect(polyfillIdx).toBeGreaterThan(-1)
    expect(firebaseIdx).toBeGreaterThan(-1)
    // The polyfill import must appear before firebase and the App import.
    expect(polyfillIdx).toBeLessThan(firebaseIdx)
    if (appIdx > -1) expect(polyfillIdx).toBeLessThan(appIdx)
  })
})
