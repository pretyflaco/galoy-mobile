/**
 * url-origin.normalizeHost — the symmetric normalizer that origin-binds the 27235 grant (Plan A).
 * Both the granted app origin (metadata.url host) and the NIP-98 `u`-tag host pass through this,
 * so the comparison is exact. Getting this right is auth-critical: a wrong normalization either
 * blocks a legitimate one-tap login or (worse) matches a host it should not.
 */
import { normalizeHost } from "../../app/nostr/core/url-origin"

describe("normalizeHost", () => {
  it("lowercases the host and strips the default https port", () => {
    expect(normalizeHost("HTTPS://Vezir.TwentyOne.ist:443/api/auth/nostr/login")).toBe(
      "vezir.twentyone.ist",
    )
  })

  it("strips the default http port", () => {
    expect(normalizeHost("http://example.com:80/x")).toBe("example.com")
  })

  it("keeps a non-default port (different port = different origin)", () => {
    expect(normalizeHost("https://host.example:8443/")).toBe("host.example:8443")
  })

  it("treats trailing-slash / path differences as the SAME host", () => {
    expect(normalizeHost("https://btcpay.twentyone.ist")).toBe(
      normalizeHost("https://btcpay.twentyone.ist/login/nostr/nip98"),
    )
  })

  it("punycodes an IDN host", () => {
    // bücher.example → xn--bcher-kva.example
    expect(normalizeHost("https://bücher.example/")).toBe("xn--bcher-kva.example")
  })

  it("returns null on unparseable input", () => {
    expect(normalizeHost("not a url")).toBeNull()
    expect(normalizeHost("")).toBeNull()
  })
})
