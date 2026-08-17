/**
 * Regression guard — Hermes `crypto.getRandomValues` polyfill.
 *
 * Hermes (the on-device RN engine) has NO Web Crypto `crypto.getRandomValues` global. nostr-tools
 * `finalizeEvent` signs via @noble/curves schnorr, which reads `globalThis.crypto.getRandomValues`
 * for the signature's auxiliary randomness. Missing it makes EVERY signed NIP-46 event throw
 * "crypto.getRandomValues must be defined" — so the connect-ack never publishes and the BTCPay
 * plugin times out. Observed on-device via `adb logcat`: publish-fail ×5 → connect-ack-unconfirmed
 * (ensureRelay + subscribe succeeded, only signing failed).
 *
 * Node/jest HAS crypto.getRandomValues, so a plain unit test can't reproduce the crash — that gap
 * is why it reached the device. We therefore (1) prove finalizeEvent DOES need the global by
 * removing it and asserting the exact throw, and (2) guard the fix's shape + import ordering so a
 * refactor can't silently re-break it on device.
 */
import fs from "fs"
import path from "path"

import { finalizeEvent, generateSecretKey } from "nostr-tools/pure"

describe("Hermes crypto.getRandomValues polyfill (device regression guard)", () => {
  it("finalizeEvent THROWS the exact Hermes error when crypto.getRandomValues is absent", () => {
    const sk = generateSecretKey()
    const template = {
      kind: 24133,
      // eslint-disable-next-line camelcase
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", "a".repeat(64)]],
      content: "ciphertext",
    }

    const realCrypto = globalThis.crypto
    try {
      // Simulate Hermes: no global crypto at all.
      // @ts-expect-error deliberately removing the global for the test
      delete globalThis.crypto
      expect(() => finalizeEvent(template, sk)).toThrow(/getRandomValues/)
    } finally {
      globalThis.crypto = realCrypto
    }

    // With the global present (as the polyfill installs on Hermes), signing succeeds.
    const signed = finalizeEvent(template, sk)
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/)
  })

  it("the polyfill module is non-clobbering (only installs when the global is absent)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../app/polyfills/crypto-get-random-values.ts"),
      "utf8",
    )
    expect(src).toMatch(
      /typeof\s+globalScope\.crypto\.getRandomValues\s*===\s*"undefined"/,
    )
    // Backed by the sanctioned native CSPRNG, not a Math.random fallback (AD-6).
    expect(src).toMatch(/react-native-quick-crypto/)
  })

  it("index.js imports the crypto polyfill BEFORE firebase/App (ordering can't regress)", () => {
    const indexSrc = fs.readFileSync(path.resolve(__dirname, "../../index.js"), "utf8")
    const cryptoIdx = indexSrc.indexOf("app/polyfills/crypto-get-random-values")
    const firebaseIdx = indexSrc.indexOf("@react-native-firebase/app")
    const appIdx = indexSrc.indexOf("./app/app")

    expect(cryptoIdx).toBeGreaterThan(-1)
    expect(firebaseIdx).toBeGreaterThan(-1)
    expect(cryptoIdx).toBeLessThan(firebaseIdx)
    if (appIdx > -1) expect(cryptoIdx).toBeLessThan(appIdx)
  })
})
