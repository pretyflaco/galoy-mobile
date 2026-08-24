/**
 * B5 — D2 delegated grant API client: canonical signing message, request shape, and
 * server-error mapping. The signing seam is injected, so no live SDK is involved.
 */
import {
  createDelegatedGrant,
  GrantApiError,
  MAX_GRANT_EXPIRY_SECS,
  revokeDelegatedGrant,
  type SignGrantMessage,
} from "@app/self-custodial/grants/grant-api"

const BASE = "https://lnurl.twentyone.ist"
const ADDRESS = "lnbitsdev@lnurl.twentyone.ist"
const OWNER = "aa".repeat(33)
const DELEGATED = "bb".repeat(33)

const signOk: SignGrantMessage = async () => ({ pubkey: OWNER, signature: "deadbeef" })

describe("createDelegatedGrant", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => "" })
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it("signs grant:{drgk}:{expiry}-{timestamp} and POSTs the D2 body with the same timestamp (AC-4)", async () => {
    const signedMessages: string[] = []
    const sign: SignGrantMessage = async (message) => {
      signedMessages.push(message)
      return { pubkey: OWNER, signature: "sig-hex" }
    }

    await createDelegatedGrant({
      base: BASE,
      lightningAddress: ADDRESS,
      delegatedPubkey: DELEGATED,
      expirySecs: 90 * 24 * 60 * 60,
      signGrantMessage: sign,
    })

    // The server's validate() appends -{timestamp} to the canonical message and the
    // SAME timestamp must be in the body — the signed string and body must agree.
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = JSON.parse(init.body)
    expect(signedMessages).toEqual([
      `grant:${DELEGATED}:${90 * 24 * 60 * 60}-${body.timestamp}`,
    ])
    expect(url).toBe(`${BASE}/lnurlpay/${OWNER}/grant`)
    expect(init.method).toBe("POST")
    expect(body.delegated_pubkey).toBe(DELEGATED)
    expect(body.expiry_secs).toBe(90 * 24 * 60 * 60)
    expect(body.signature).toBe("sig-hex")
    expect(Number.isInteger(body.timestamp)).toBe(true)
  })

  it("rejects an expiry above the 365-day server cap before signing", async () => {
    await expect(
      createDelegatedGrant({
        base: BASE,
        lightningAddress: ADDRESS,
        delegatedPubkey: DELEGATED,
        expirySecs: MAX_GRANT_EXPIRY_SECS + 1,
        signGrantMessage: signOk,
      }),
    ).rejects.toThrow(/invalid expiry/)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("guards against delegating to the identity key itself", async () => {
    const signSelf: SignGrantMessage = async () => ({ pubkey: DELEGATED, signature: "x" })
    const err = await createDelegatedGrant({
      base: BASE,
      lightningAddress: ADDRESS,
      delegatedPubkey: DELEGATED,
      expirySecs: 3600,
      signGrantMessage: signSelf,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(GrantApiError)
    expect(err.kind).toBe("identity-key-delegation")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  const errorCases: Array<[number, GrantApiError["kind"], string]> = [
    [429, "rate-limit", "too many requests"],
    [409, "conflict", "nope"],
    [404, "not-found", ""],
    [400, "invalid-pubkey", "invalid pubkey"],
    [400, "identity-key-delegation", "cannot delegate to the identity key"],
    [400, "invalid-expiry", "invalid expiry"],
  ]
  for (const [status, kind, body] of errorCases) {
    it(`maps a ${status} ${kind} response to the right error kind`, async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status,
        text: async () => body,
      })
      const err = await createDelegatedGrant({
        base: BASE,
        lightningAddress: ADDRESS,
        delegatedPubkey: DELEGATED,
        expirySecs: 3600,
        signGrantMessage: signOk,
      }).catch((e) => e)
      expect(err).toBeInstanceOf(GrantApiError)
      expect(err.kind).toBe(kind)
    })
  }

  it("maps a network failure to the network kind", async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error("offline"))
    const err = await createDelegatedGrant({
      base: BASE,
      lightningAddress: ADDRESS,
      delegatedPubkey: DELEGATED,
      expirySecs: 3600,
      signGrantMessage: signOk,
    }).catch((e) => e)
    expect(err.kind).toBe("network")
  })
})

describe("revokeDelegatedGrant (AC-5)", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => "" })
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it("DELETEs the grant endpoint with signature+timestamp as query params over the timestamp-suffixed revoke message", async () => {
    const messages: string[] = []
    const sign: SignGrantMessage = async (message) => {
      messages.push(message)
      return { pubkey: OWNER, signature: "sig-hex" }
    }

    await revokeDelegatedGrant({
      base: BASE,
      ownerPubkey: OWNER,
      delegatedPubkey: DELEGATED,
      signGrantMessage: sign,
    })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(init.method).toBe("DELETE")
    expect(url).toMatch(
      new RegExp(
        `^${BASE}/lnurlpay/${OWNER}/grant/${DELEGATED}\\?signature=sig-hex&timestamp=\\d+$`,
      ),
    )
    const queryTimestamp = Number(url.split("timestamp=")[1])
    expect(messages).toEqual([`revoke:${DELEGATED}-${queryTimestamp}`])
  })
})
