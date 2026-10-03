/**
 * Story 1.3 / AC-4 — metadata-only, leak-safe logging. No nsec, decrypted plaintext, or
 * event content may reach logs / analytics / crash payloads. The signer emits only
 * metadata (kind, client pubkey, request id, timing/duration) via `signerLogFields`,
 * and `assertNoSecrets` guards any payload against secret leakage.
 */
import { signerLogFields, assertNoSecrets } from "../../app/nostr/core/redact"

describe("metadata-only logging (AC-4)", () => {
  it("signerLogFields keeps only the allowed metadata keys", () => {
    const fields = signerLogFields({
      kind: 22242,
      clientPubkey: "abcd",
      requestId: "req-1",
      durationMs: 12,
      // everything below MUST be dropped:
      nsec: "0000...secret",
      plaintext: "hello world",
      content: "event content body",
      ciphertext: "deadbeefcafe",
      sig: "aabbcc",
    })
    expect(Object.keys(fields).sort()).toEqual(
      ["clientPubkey", "durationMs", "kind", "requestId"].sort(),
    )
    expect(JSON.stringify(fields)).not.toMatch(
      /secret|hello world|event content|deadbeef/,
    )
  })

  it("assertNoSecrets throws if a secret/plaintext/content value appears in a payload", () => {
    const secretHex = "a".repeat(64)
    expect(() =>
      assertNoSecrets({ msg: "signed", leaked: secretHex }, { secrets: [secretHex] }),
    ).toThrow()
    expect(() =>
      assertNoSecrets({ nested: { deep: secretHex } }, { secrets: [secretHex] }),
    ).toThrow()
  })

  it("assertNoSecrets passes for a metadata-only payload", () => {
    expect(() =>
      assertNoSecrets(
        { kind: 1, clientPubkey: "abcd", requestId: "r", durationMs: 5 },
        { secrets: ["a".repeat(64)] },
      ),
    ).not.toThrow()
  })

  it("assertNoSecrets rejects known secret-bearing keys even without a known value", () => {
    expect(() => assertNoSecrets({ nsec: "whatever" })).toThrow()
    expect(() => assertNoSecrets({ privateKeyHex: "x" })).toThrow()
    expect(() => assertNoSecrets({ plaintext: "x" })).toThrow()
  })
})
