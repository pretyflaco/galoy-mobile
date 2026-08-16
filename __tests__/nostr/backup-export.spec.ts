/**
 * Story 1.7 — nsec backup/export bridge (AD-2 second nsec reader). Core rules:
 *   AC-4: cloud nsec backup is ENCRYPTED by default, OR unencrypted ONLY with an explicit
 *   plaintext acknowledgment; the byte-for-byte passwordless-plaintext write is FORBIDDEN.
 *   AC-2: a backup round-trips — the restored nsec derives the same pubkey.
 */
// Use REAL Node crypto for quick-crypto so AES-GCM actually round-trips in Jest
// (mirrors __tests__/utils/backup-payload.spec.ts); the deterministic mock cannot decrypt.
jest.mock("react-native-quick-crypto", () => {
  const crypto = jest.requireActual("crypto") as typeof import("crypto")
  return {
    __esModule: true,
    default: {
      randomBytes: crypto.randomBytes,
      pbkdf2Sync: crypto.pbkdf2Sync,
      createCipheriv: crypto.createCipheriv,
      createDecipheriv: crypto.createDecipheriv,
      publicEncrypt: crypto.publicEncrypt,
      constants: crypto.constants,
    },
    Buffer,
  }
})

import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

import {
  buildNsecCloudBackup,
  restoreNsecFromCloud,
  isForbiddenPlaintextWrite,
} from "../../app/nostr/core/backup-export"

const sk = new Uint8Array(32)
sk[31] = 11
const NSEC_HEX = bytesToHex(sk)
const PUB_HEX = bytesToHex(schnorr.getPublicKey(sk))
const NPUB = nip19.npubEncode(PUB_HEX)

describe("cloud nsec backup — encrypt-or-acknowledge (AC-4, ratification freeze point)", () => {
  it("DEFAULT: with a password, produces an ENCRYPTED blob (no plaintext nsec on disk)", () => {
    const blob = buildNsecCloudBackup({
      nsecHex: NSEC_HEX,
      npub: NPUB,
      password: "correct horse battery staple",
    })
    const parsed = JSON.parse(blob)
    expect(parsed.encrypted).toBe(true)
    expect(blob).not.toContain(NSEC_HEX) // secret never appears in the blob
  })

  it("REJECTS a passwordless write WITHOUT explicit plaintext acknowledgment (forbidden path)", () => {
    expect(() => buildNsecCloudBackup({ nsecHex: NSEC_HEX, npub: NPUB })).toThrow()
    expect(() =>
      buildNsecCloudBackup({
        nsecHex: NSEC_HEX,
        npub: NPUB,
        acknowledgePlaintext: false,
      }),
    ).toThrow()
  })

  it("FALLBACK: allows an unencrypted blob ONLY with an explicit plaintext acknowledgment", () => {
    const blob = buildNsecCloudBackup({
      nsecHex: NSEC_HEX,
      npub: NPUB,
      acknowledgePlaintext: true,
    })
    const parsed = JSON.parse(blob)
    expect(parsed.encrypted).toBe(false)
  })

  it("a password takes precedence — never emits plaintext even if ack is also set", () => {
    const blob = buildNsecCloudBackup({
      nsecHex: NSEC_HEX,
      npub: NPUB,
      password: "pw",
      acknowledgePlaintext: true,
    })
    expect(JSON.parse(blob).encrypted).toBe(true)
  })
})

describe("isForbiddenPlaintextWrite guard", () => {
  it("is true only for passwordless + unacknowledged", () => {
    expect(isForbiddenPlaintextWrite({ hasPassword: false, acknowledged: false })).toBe(
      true,
    )
    expect(isForbiddenPlaintextWrite({ hasPassword: true, acknowledged: false })).toBe(
      false,
    )
    expect(isForbiddenPlaintextWrite({ hasPassword: false, acknowledged: true })).toBe(
      false,
    )
  })
})

describe("restore round-trip (AC-2)", () => {
  it("encrypted blob restores to the same nsec (derives the same pubkey)", () => {
    const blob = buildNsecCloudBackup({ nsecHex: NSEC_HEX, npub: NPUB, password: "pw" })
    const restored = restoreNsecFromCloud(blob, "pw")
    expect(restored.nsecHex).toBe(NSEC_HEX)
    expect(
      bytesToHex(
        schnorr.getPublicKey(Uint8Array.from(Buffer.from(restored.nsecHex, "hex"))),
      ),
    ).toBe(PUB_HEX)
  })

  it("plaintext-acknowledged blob restores directly", () => {
    const blob = buildNsecCloudBackup({
      nsecHex: NSEC_HEX,
      npub: NPUB,
      acknowledgePlaintext: true,
    })
    const restored = restoreNsecFromCloud(blob)
    expect(restored.nsecHex).toBe(NSEC_HEX)
  })

  it("wrong password fails to restore an encrypted blob", () => {
    const blob = buildNsecCloudBackup({ nsecHex: NSEC_HEX, npub: NPUB, password: "pw" })
    expect(() => restoreNsecFromCloud(blob, "wrong")).toThrow()
  })
})
