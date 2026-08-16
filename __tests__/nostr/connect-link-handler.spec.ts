/**
 * Story A3 — nostrconnect:// deep-link / QR handler registry.
 *
 * The URL + QR entry points recognize the nostrconnect:// scheme and forward the RAW URI to
 * ConnectFlow via the runtime handler the provider registers while the signer is enabled (AD-9).
 * When the flag is off, no handler is registered, so a nostrconnect:// URI is not consumed and
 * falls through unchanged (signer invisible + inert, NFR-9).
 */
import {
  handleNostrConnectLink,
  isNostrConnectLink,
  setNostrConnectHandler,
} from "../../app/nostr/connect-link-handler"

const NC_URI =
  "nostrconnect://" +
  "b".repeat(64) +
  "?relay=wss%3A%2F%2Fnos.lol&secret=s3cr3t&perms=sign_event%3A22242"

afterEach(() => setNostrConnectHandler(null))

describe("nostrconnect:// link recognition (A3)", () => {
  it("recognizes a nostrconnect:// URI and rejects other schemes", () => {
    expect(isNostrConnectLink(NC_URI)).toBe(true)
    expect(isNostrConnectLink("lightning://abc")).toBe(false)
    expect(isNostrConnectLink("bitcoin:bc1qxyz")).toBe(false)
    expect(isNostrConnectLink("https://btcpay.example/login")).toBe(false)
  })
})

describe("forwarding to the runtime handler (A3 / AD-9)", () => {
  it("forwards the RAW URI byte-for-byte to the registered handler and reports handled", async () => {
    const handler = jest.fn(async () => undefined)
    setNostrConnectHandler(handler)

    const handled = await handleNostrConnectLink(NC_URI)

    expect(handled).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(NC_URI) // unparsed, verbatim (AD-9)
  })

  it("does NOT forward a non-nostrconnect URI even when a handler is registered", async () => {
    const handler = jest.fn(async () => undefined)
    setNostrConnectHandler(handler)

    const handled = await handleNostrConnectLink("lightning://abc")

    expect(handled).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it("is a no-op (returns false) when the signer is disabled (no handler registered)", async () => {
    // flag OFF: provider registered nothing.
    const handled = await handleNostrConnectLink(NC_URI)
    expect(handled).toBe(false)
  })

  it("clears the handler when set to null (flag toggled off)", async () => {
    const handler = jest.fn(async () => undefined)
    setNostrConnectHandler(handler)
    setNostrConnectHandler(null)

    const handled = await handleNostrConnectLink(NC_URI)

    expect(handled).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })
})
