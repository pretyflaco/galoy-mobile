/**
 * Story 4.1 — NIP-89 (kind-31990) signer advertisement (FR-17 / CAP-9 / AD-15).
 *
 * AD-15: the advertisement is OPS-OWNED — the pure builder (no nsec, no network) lives under
 * scripts/, is signed only by the ops publish script from ops-secret env, and NONE of it ships
 * in the mobile app bundle. These tests cover the pure builder, the nostr.json author
 * cross-check, the sign-and-verify path (with a FIXTURE nsec — never real ops key material),
 * and an app/ leak-audit scan.
 */
import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"

import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { finalizeEvent, verifyEvent } from "nostr-tools/pure"

import {
  buildSignerAdvertisement,
  verifyAdvertisementAuthor,
  prepareAdvertisementForPublish,
  NIP89_HANDLER_KIND,
  NIP46_KIND,
} from "../../scripts/lib/nip89-advertisement"

// A FIXTURE key (deterministic, NOT ops key material) for sign-and-verify tests.
const FIXTURE_SK = new Uint8Array(32).fill(9)
const FIXTURE_PUB = bytesToHex(schnorr.getPublicKey(FIXTURE_SK))

const metadata = {
  name: "blink",
  // eslint-disable-next-line camelcase
  display_name: "Blink",
  about: "Sign in with Blink — a NIP-46 remote signer built into blink-mobile.",
}

describe("buildSignerAdvertisement (kind-31990, FR-17)", () => {
  it("is a kind-31990 Handler Information event", () => {
    const ad = buildSignerAdvertisement({
      pubkey: FIXTURE_PUB,
      metadata,
      createdAt: 1000,
    })
    expect(ad.kind).toBe(31990)
    expect(NIP89_HANDLER_KIND).toBe(31990)
  })

  it("carries a stable d tag (parameterized-replaceable identity)", () => {
    const ad = buildSignerAdvertisement({
      pubkey: FIXTURE_PUB,
      metadata,
      identifier: "blink-signer",
      createdAt: 1000,
    })
    const dTag = ad.tags.find((t) => t[0] === "d")
    expect(dTag?.[1]).toBe("blink-signer")
  })

  it("declares a k tag for 24133 (NIP-46 / NostrConnect) marking it a NIP-46 signer", () => {
    const ad = buildSignerAdvertisement({
      pubkey: FIXTURE_PUB,
      metadata,
      createdAt: 1000,
    })
    const kTags = ad.tags.filter((t) => t[0] === "k").map((t) => t[1])
    expect(kTags).toContain(String(NIP46_KIND))
    expect(NIP46_KIND).toBe(24133)
  })

  it("content is well-formed JSON metadata identifying blink-mobile as a NIP-46 signer", () => {
    const ad = buildSignerAdvertisement({
      pubkey: FIXTURE_PUB,
      metadata,
      createdAt: 1000,
    })
    const parsed = JSON.parse(ad.content)
    expect(parsed.name).toBe("blink")
    expect(String(parsed.about)).toMatch(/NIP-46/i)
  })

  it("is pure/deterministic: same inputs → same template (created_at injected)", () => {
    const a = buildSignerAdvertisement({ pubkey: FIXTURE_PUB, metadata, createdAt: 1000 })
    const b = buildSignerAdvertisement({ pubkey: FIXTURE_PUB, metadata, createdAt: 1000 })
    expect(a).toEqual(b)
    // pubkey is set from the input (no key generation in the builder).
    expect(a.pubkey).toBe(FIXTURE_PUB)
  })

  it("supports overriding the handled kinds (wire detail not frozen)", () => {
    const ad = buildSignerAdvertisement({
      pubkey: FIXTURE_PUB,
      metadata,
      handledKinds: [24133, 22242],
      createdAt: 1000,
    })
    const kTags = ad.tags.filter((t) => t[0] === "k").map((t) => t[1])
    expect(kTags).toEqual(["24133", "22242"])
  })
})

describe("verifyAdvertisementAuthor (nostr.json cross-check, AC #3)", () => {
  it("passes when the event pubkey matches nostr.json names._", () => {
    const ad = buildSignerAdvertisement({
      pubkey: FIXTURE_PUB,
      metadata,
      createdAt: 1000,
    })
    const nostrJson = { names: { _: FIXTURE_PUB } }
    expect(verifyAdvertisementAuthor(ad, nostrJson)).toBe(true)
  })

  it("fails when the author pubkey is spoofed (mismatch)", () => {
    const ad = buildSignerAdvertisement({
      pubkey: FIXTURE_PUB,
      metadata,
      createdAt: 1000,
    })
    const nostrJson = { names: { _: "b".repeat(64) } }
    expect(verifyAdvertisementAuthor(ad, nostrJson)).toBe(false)
  })

  it("fails when nostr.json has no matching name entry", () => {
    const ad = buildSignerAdvertisement({
      pubkey: FIXTURE_PUB,
      metadata,
      createdAt: 1000,
    })
    expect(verifyAdvertisementAuthor(ad, { names: {} })).toBe(false)
  })
})

describe("prepareAdvertisementForPublish (ops sign path, AC #2)", () => {
  const readSecret = () => bytesToHex(FIXTURE_SK)

  it("signs the built advertisement with the ops nsec; the signature verifies", () => {
    const signed = prepareAdvertisementForPublish({
      readNsecHex: readSecret,
      metadata,
      identifier: "blink-signer",
      createdAt: 1000,
      finalize: finalizeEvent,
    })
    // Round-trip through JSON so verifyEvent does a REAL check (no cached verifiedSymbol).
    const overWire = JSON.parse(JSON.stringify(signed))
    expect(verifyEvent(overWire)).toBe(true)
    expect(signed.kind).toBe(31990)
  })

  it("the signed event's pubkey matches the nsec's public key (nostr.json will cross-check)", () => {
    const signed = prepareAdvertisementForPublish({
      readNsecHex: readSecret,
      metadata,
      createdAt: 1000,
      finalize: finalizeEvent,
    })
    expect(signed.pubkey).toBe(FIXTURE_PUB)
    expect(verifyAdvertisementAuthor(signed, { names: { _: FIXTURE_PUB } })).toBe(true)
  })

  it("REFUSES to run (throws) when the ops secret is absent", () => {
    expect(() =>
      prepareAdvertisementForPublish({
        readNsecHex: () => "",
        metadata,
        createdAt: 1000,
        finalize: finalizeEvent,
      }),
    ).toThrow()
  })
})

describe("AD-15 leak-audit: no advertisement key material / NIP-89 in app/", () => {
  const APP_DIR = join(__dirname, "..", "..", "app")

  const walk = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...walk(full))
      else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full)
    }
    return out
  }

  it("app/ contains no kind-31990 advertisement / publish key material (AD-15)", () => {
    const files = walk(APP_DIR)
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, "utf8")
      if (/31990|Handlerinformation|ADVERT_NSEC|publish-nip89/i.test(src)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
