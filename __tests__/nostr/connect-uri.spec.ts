/**
 * Story 3.3 Task 1 — nostrconnect:// URI parsing + mandatory-secret rule (AC #1/#2, AD-8).
 *
 * Extracts clientPubkey, relays, secret, perms, and client metadata. The `secret` is
 * MANDATORY: a URI without one is rejected BEFORE any approval surface (pairing without a
 * secret is the Mike Dilger connection-hijacking attack; hardened clients reject it).
 */
import { parseNostrConnectUri } from "../../app/nostr/transport/connect-flow"

const CLIENT = "cafe".repeat(16) // 64 hex chars

describe("parseNostrConnectUri (AC #1/#2)", () => {
  it("parses clientPubkey, relays, secret, perms, and metadata", () => {
    const uri =
      `nostrconnect://${CLIENT}` +
      "?relay=wss%3A%2F%2Frelay.one&relay=wss%3A%2F%2Frelay.two" +
      "&secret=xyz123&perms=sign_event%3A22242%2Cnip44_decrypt" +
      "&name=Damus&url=https%3A%2F%2Fdamus.io"
    const parsed = parseNostrConnectUri(uri)
    expect(parsed).toEqual({
      clientPubkey: CLIENT,
      relays: ["wss://relay.one", "wss://relay.two"],
      secret: "xyz123",
      perms: ["sign_event:22242", "nip44_decrypt"],
      metadata: { name: "Damus", url: "https://damus.io" },
    })
  })

  it("rejects a secret-less URI (Mike Dilger attack) — returns null, no side effects", () => {
    const uri = `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr&name=Damus`
    expect(parseNostrConnectUri(uri)).toBeNull()
  })

  it("rejects an empty secret", () => {
    const uri = `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr&secret=`
    expect(parseNostrConnectUri(uri)).toBeNull()
  })

  it("rejects a non-nostrconnect scheme", () => {
    expect(parseNostrConnectUri(`bunker://${CLIENT}?secret=x`)).toBeNull()
  })

  it("rejects a URI without a client pubkey", () => {
    expect(parseNostrConnectUri("nostrconnect://?secret=x")).toBeNull()
  })

  it("parses with empty perms when none are supplied", () => {
    const uri = `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr&secret=s`
    expect(parseNostrConnectUri(uri)?.perms).toEqual([])
  })
})
