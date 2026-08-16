/**
 * Story 1.8 / AC-1, AC-3 — runtime leak-audit via the redact guard (Story 1.3).
 * assertNoSecrets must catch key material / plaintext / content in nested payloads;
 * signerLogFields must project down to the metadata allow-list. This forward-covers the
 * Epic 3 NIP-46 pipeline logging surface (kind, client pubkey, request id, timing only).
 */
import { assertNoSecrets, signerLogFields } from "../../app/nostr/core/redact"

const NSEC = "a".repeat(64)
const PLAINTEXT = "the decrypted DM body"

describe("runtime leak guard on realistic payloads (AC-1)", () => {
  it("throws when a nsec appears anywhere in a log/analytics/crash payload", () => {
    expect(() =>
      assertNoSecrets(
        { level: "info", meta: { deep: { nsec: NSEC } } },
        { secrets: [NSEC] },
      ),
    ).toThrow()
  })

  it("throws when decrypted plaintext / event content appears", () => {
    expect(() =>
      assertNoSecrets({ content: PLAINTEXT }, { secrets: [PLAINTEXT] }),
    ).toThrow()
    expect(() => assertNoSecrets({ plaintext: "x" })).toThrow()
  })

  it("passes for a metadata-only payload", () => {
    expect(() =>
      assertNoSecrets(
        { kind: 22242, clientPubkey: "abcd", requestId: "r1", durationMs: 8 },
        { secrets: [NSEC, PLAINTEXT] },
      ),
    ).not.toThrow()
  })
})

describe("Epic 3 pipeline logging is metadata-only (AC-3, forward-compat)", () => {
  it("signerLogFields drops content/secret keys, keeps only metadata", () => {
    const emitted = signerLogFields({
      kind: 22242,
      clientPubkey: "abcd",
      requestId: "r1",
      durationMs: 12,
      // simulated NIP-46 request fields that must NEVER be logged:
      content: PLAINTEXT,
      ciphertext: "deadbeef",
      nsec: NSEC,
    })
    expect(Object.keys(emitted).sort()).toEqual(
      ["clientPubkey", "durationMs", "kind", "requestId"].sort(),
    )
    // the projected object, once stringified for a log line, contains no secret/content
    const line = JSON.stringify(emitted)
    for (const forbidden of [NSEC, PLAINTEXT, "deadbeef"]) {
      expect(line).not.toContain(forbidden)
    }
  })

  it("a projected metadata line passes the leak guard", () => {
    const emitted = signerLogFields({
      kind: 1,
      clientPubkey: "cafe",
      requestId: "r2",
      durationMs: 3,
      content: PLAINTEXT,
    })
    expect(() => assertNoSecrets(emitted, { secrets: [PLAINTEXT] })).not.toThrow()
  })
})
