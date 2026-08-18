/**
 * Story 3.3 Task 1 — nostrconnect:// URI parsing (AC #1/#2, AD-8) + interop.
 *
 * Extracts clientPubkey, relays, secret, perms, and client metadata. The `secret` is now
 * OPTIONAL (interop with Plebeian.market / Amber-style secret-less URIs); the human connection
 * approval is the consent gate. Identity/perms also parse from a `metadata=` JSON blob fallback.
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

  it("ACCEPTS a secret-less URI (interop) — secret is undefined", () => {
    const uri = `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr&name=Damus`
    const parsed = parseNostrConnectUri(uri)
    expect(parsed).not.toBeNull()
    expect(parsed?.secret).toBeUndefined()
    expect(parsed?.metadata.name).toBe("Damus")
  })

  it("treats an empty secret as absent (undefined, not a rejection)", () => {
    const uri = `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr&secret=`
    expect(parseNostrConnectUri(uri)?.secret).toBeUndefined()
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

  describe("metadata= JSON blob (Plebeian.market / Amber parity)", () => {
    it("parses name/url/image/perms from the blob when separate params are absent", () => {
      const blob = JSON.stringify({
        name: "Plebeian.market",
        url: "https://plebeian.market",
        image: "https://plebeian.market/logo.png",
        perms: "sign_event:27235,get_public_key",
      })
      const uri =
        `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr` +
        `&metadata=${encodeURIComponent(blob)}&token=ijbdmjfn13g`
      const parsed = parseNostrConnectUri(uri)
      expect(parsed).not.toBeNull()
      expect(parsed?.secret).toBeUndefined() // token= is NOT a secret; ignored
      expect(parsed?.metadata).toEqual({
        name: "Plebeian.market",
        url: "https://plebeian.market",
        image: "https://plebeian.market/logo.png",
      })
      expect(parsed?.perms).toEqual(["sign_event:27235", "get_public_key"])
    })

    it("uses icons[0] as the image when the blob has no image field", () => {
      const blob = JSON.stringify({
        name: "App",
        url: "https://app.example",
        icons: ["https://app.example/icon.png"],
      })
      const uri = `nostrconnect://${CLIENT}?metadata=${encodeURIComponent(blob)}`
      expect(parseNostrConnectUri(uri)?.metadata.image).toBe(
        "https://app.example/icon.png",
      )
    })

    it("lets separate params WIN over the blob", () => {
      const blob = JSON.stringify({ name: "BlobName", url: "https://blob.example" })
      const uri =
        `nostrconnect://${CLIENT}?name=ParamName` +
        `&metadata=${encodeURIComponent(blob)}`
      expect(parseNostrConnectUri(uri)?.metadata.name).toBe("ParamName")
    })

    it("ignores a malformed blob (no throw, empty metadata)", () => {
      const uri = `nostrconnect://${CLIENT}?metadata=%7Bnot-json`
      const parsed = parseNostrConnectUri(uri)
      expect(parsed).not.toBeNull()
      expect(parsed?.metadata).toEqual({})
    })

    it("drops a non-http url from the blob (origin-binding safety)", () => {
      // eslint-disable-next-line no-script-url
      const badUrl = "javascript:alert(1)"
      const blob = JSON.stringify({ name: "Evil", url: badUrl })
      const uri = `nostrconnect://${CLIENT}?metadata=${encodeURIComponent(blob)}`
      expect(parseNostrConnectUri(uri)?.metadata.url).toBeUndefined()
    })
  })
})
