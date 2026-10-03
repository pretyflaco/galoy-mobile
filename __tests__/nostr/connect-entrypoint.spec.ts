/**
 * Story 3.3 Task 10 — deep-link / QR entry point forwards the RAW nostrconnect:// URI to
 * ConnectFlow and performs NO parsing or approval itself (AD-9). The existing scanner /
 * deep-link handler is reused; the handler only recognizes the scheme and forwards.
 */
import {
  isNostrConnectUri,
  forwardNostrConnectUri,
} from "../../app/nostr/transport/connect-entrypoint"

const CLIENT = "cafe".repeat(16)
const RAW = `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Fr&secret=s&name=Damus`

describe("connect entry point (AC #1, AD-9)", () => {
  it("recognizes a nostrconnect:// URI and ignores everything else", () => {
    expect(isNostrConnectUri(RAW)).toBe(true)
    expect(isNostrConnectUri("bitcoin:bc1...")).toBe(false)
    expect(isNostrConnectUri("bunker://x")).toBe(false)
    expect(isNostrConnectUri("")).toBe(false)
  })

  it("forwards the RAW URI unmodified to ConnectFlow (no parse, no approval here)", async () => {
    const handleConnect = jest.fn(async (_uri: string) => undefined)
    const forwarded = await forwardNostrConnectUri(RAW, { handleConnect })
    expect(forwarded).toBe(true)
    expect(handleConnect).toHaveBeenCalledWith(RAW) // byte-for-byte, unparsed
  })

  it("does not forward a non-nostrconnect URI", async () => {
    const handleConnect = jest.fn(async (_uri: string) => undefined)
    const forwarded = await forwardNostrConnectUri("lightning:lnbc...", {
      handleConnect,
    })
    expect(forwarded).toBe(false)
    expect(handleConnect).not.toHaveBeenCalled()
  })
})
