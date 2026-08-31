import {
  canonicalUsername,
  checkAddressAvailableOnDomain,
  LnurlRegisterError,
  registerAddressOnDomain,
  signedRegisterMessage,
} from "@app/self-custodial/lnurl-register"

const BASE = "https://blink.sv"
const PUBKEY = "02abcdef"

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

const okJson = (body: unknown) =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response)

const errJson = (status: number, body: string) =>
  Promise.resolve({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  } as Response)

const signMessage = jest.fn(async (_message: string) => ({ pubkey: PUBKEY, signature: "deadbeef" }))

beforeEach(() => {
  jest.clearAllMocks()
})

describe("canonicalUsername", () => {
  it("trims and lowercases — the server canonicalizes before verifying", () => {
    expect(canonicalUsername("  Satoshi_Nakamoto ")).toBe("satoshi_nakamoto")
  })
})

describe("signedRegisterMessage", () => {
  it("is the canonical username plus the timestamp, exactly what the server verifies", () => {
    expect(signedRegisterMessage("Satoshi", 1234567890)).toBe("satoshi-1234567890")
  })
})

describe("checkAddressAvailableOnDomain", () => {
  it("GETs the availability route with the canonical username", async () => {
    mockFetch.mockReturnValue(okJson({ available: true }))

    const available = await checkAddressAvailableOnDomain(BASE, "Satoshi")

    expect(available).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      "https://blink.sv/lnurlpay/available/satoshi",
      undefined,
    )
  })

  it("maps a fetch failure to a network error", async () => {
    mockFetch.mockRejectedValue(new Error("offline"))

    await expect(checkAddressAvailableOnDomain(BASE, "satoshi")).rejects.toMatchObject({
      kind: "network",
    })
  })
})

describe("registerAddressOnDomain", () => {
  it("signs the canonical message BEFORE posting, then POSTs the signed payload", async () => {
    mockFetch.mockReturnValue(okJson({ lightning_address: "satoshi@blink.sv" }))

    const address = await registerAddressOnDomain({
      base: BASE,
      username: "Satoshi",
      signMessage,
    })

    expect(address).toBe("satoshi@blink.sv")

    const signedMessage = signMessage.mock.calls[0][0] as string
    /** The body's timestamp must be the one inside the signed message — the server
     *  rejects a mismatch. */
    const timestamp = Number(signedMessage.split("-").pop())
    expect(signedMessage).toBe(`satoshi-${timestamp}`)

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://blink.sv/lnurlpay/${PUBKEY}`)
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      username: "satoshi",
      signature: "deadbeef",
      timestamp,
      description: "Pay satoshi@blink.sv",
    })
  })

  it("maps a 409 name-taken to a taken error", async () => {
    mockFetch.mockReturnValue(errJson(409, "name already taken"))

    await expect(
      registerAddressOnDomain({ base: BASE, username: "satoshi", signMessage }),
    ).rejects.toMatchObject({ kind: "taken" })
  })

  it("maps the anon-registration refusal to enhanced-mode-required", async () => {
    mockFetch.mockReturnValue(errJson(409, "enhanced_mode_required"))

    await expect(
      registerAddressOnDomain({ base: BASE, username: "satoshi", signMessage }),
    ).rejects.toMatchObject({ kind: "enhanced-mode-required" })
  })

  it("maps a rate limit distinctly", async () => {
    mockFetch.mockReturnValue(errJson(429, "slow down"))

    await expect(
      registerAddressOnDomain({ base: BASE, username: "satoshi", signMessage }),
    ).rejects.toBeInstanceOf(LnurlRegisterError)
    mockFetch.mockReturnValue(errJson(429, "slow down"))
    await expect(
      registerAddressOnDomain({ base: BASE, username: "satoshi", signMessage }),
    ).rejects.toMatchObject({ kind: "rate-limit" })
  })
})
