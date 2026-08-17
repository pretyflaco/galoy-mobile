/**
 * Story 3.2 — standard NIP-46 method handlers + unknown-method spec error (AC #4, AD-16).
 *
 * Handles connect / get_public_key / ping per spec; get_public_key returns the user's x-only
 * pubkey as HEX (NIP-46 wire format — NOT npub; a bech32 npub is rejected by NIP-46 clients such
 * as the btcpay-nostr-login plugin, which requires result.Length == 64 && all hex). Any unknown
 * method — including switch_relays in v1 — returns a spec error reply. Method names and request
 * ids are taken verbatim from the message.
 *
 * (sign_event, nip04_/nip44_ land in Stories 3.5/3.6; logout = client disconnect, AD-8.)
 */
import {
  dispatchNip46Method,
  type MethodPorts,
} from "../../app/nostr/transport/nip46-methods"
import type { Nip46Request } from "../../app/nostr/transport/nip46-codec"

// A valid 64-char lowercase-hex x-only pubkey (the NIP-46 get_public_key wire format).
const USER_PUBKEY_HEX = "a".repeat(64)

const makePorts = (over: Partial<MethodPorts> = {}): MethodPorts => ({
  getPublicKeyHex: jest.fn(async () => USER_PUBKEY_HEX),
  ...over,
})

const req = (method: string, params: string[] = [], id = "req-1"): Nip46Request => ({
  id,
  method,
  params,
})

describe("standard methods (AC #4)", () => {
  it("ping → result 'pong', echoing the request id verbatim", async () => {
    const res = await dispatchNip46Method(req("ping", [], "VERBATIM-1"), makePorts())
    expect(res).toEqual({ id: "VERBATIM-1", result: "pong" })
  })

  it("get_public_key → the user pubkey as 64-char HEX, not npub (NIP-46 interop)", async () => {
    const getPublicKeyHex = jest.fn(async () => USER_PUBKEY_HEX)
    const res = await dispatchNip46Method(
      req("get_public_key"),
      makePorts({ getPublicKeyHex }),
    )
    expect(res).toEqual({ id: "req-1", result: USER_PUBKEY_HEX })
    expect(getPublicKeyHex).toHaveBeenCalledTimes(1)
    // Interop: the plugin requires result.Length == 64 && all hex — a bech32 npub would fail.
    expect(res.result).toMatch(/^[0-9a-f]{64}$/)
    expect(res.result?.startsWith("npub")).toBe(false)
  })

  it("connect → spec ack result", async () => {
    const res = await dispatchNip46Method(req("connect", ["remotepubkey"]), makePorts())
    expect(res).toMatchObject({ id: "req-1", result: "ack" })
    expect(res.error).toBeUndefined()
  })
})

describe("unknown method → spec error reply (AC #4)", () => {
  it("switch_relays (unsupported in v1) yields a NIP-46 error field, not a result", async () => {
    const res = await dispatchNip46Method(req("switch_relays"), makePorts())
    expect(res.result).toBeUndefined()
    expect(typeof res.error).toBe("string")
    expect(res.error).toMatch(/unsupported|unknown/i)
    expect(res.id).toBe("req-1") // id preserved
  })

  it("an arbitrary unknown method yields a spec error reply", async () => {
    const res = await dispatchNip46Method(req("frobnicate"), makePorts())
    expect(res.error).toBeTruthy()
    expect(res.result).toBeUndefined()
  })

  it("does not call the seam for an unknown method", async () => {
    const getPublicKeyHex = jest.fn(async () => USER_PUBKEY_HEX)
    await dispatchNip46Method(req("switch_relays"), makePorts({ getPublicKeyHex }))
    expect(getPublicKeyHex).not.toHaveBeenCalled()
  })
})
