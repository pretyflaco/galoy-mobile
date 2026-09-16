import {
  Nip05RegisterError,
  registerBlinkNostrIdentity,
  registerSparkNostrIdentity,
  signedNostrRegisterMessage,
} from "@app/nostr/nip05/nip05-client"
import { buildNip05ProofTemplate } from "@app/nostr/nip05/proof"
import { mergeProfileMetadata } from "@app/nostr/core/profile-publish"

const BASE = "https://blink.sv"
const SPARK_PUBKEY = "02abcdef"
const NOSTR_PUBKEY = "a1".repeat(32)
const PROOF = JSON.stringify({ kind: 22242, tags: [["lnaddress", "alice@blink.sv"]] })

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

const SERVER_OK = {
  username: "alice",
  domain: "blink.sv",
  // eslint-disable-next-line camelcase -- server response payload is snake_case
  nostr_pubkey: NOSTR_PUBKEY,
  nip05: "alice@blink.sv",
}

const signMessage = jest.fn(async (_message: string) => ({
  pubkey: SPARK_PUBKEY,
  signature: "deadbeef",
}))

beforeEach(() => {
  jest.clearAllMocks()
})

describe("signedNostrRegisterMessage", () => {
  it("is the nostr-prefixed pubkey plus the timestamp, exactly what the server verifies", () => {
    expect(signedNostrRegisterMessage(NOSTR_PUBKEY, 1234567890)).toBe(
      `nostr:${NOSTR_PUBKEY}-1234567890`,
    )
  })
})

describe("buildNip05ProofTemplate", () => {
  it("is a kind-22242 event carrying exactly one lnaddress tag", () => {
    const fixed = 1700000000
    const template = buildNip05ProofTemplate("alice@blink.sv", () => fixed)

    expect(template.kind).toBe(22242)
    expect(template.created_at).toBe(fixed)
    expect(template.content).toBe("")
    expect(template.tags).toEqual([["lnaddress", "alice@blink.sv"]])
  })
})

describe("registerSparkNostrIdentity", () => {
  it("signs the canonical message then POSTs the dual-proof payload", async () => {
    mockFetch.mockReturnValue(okJson(SERVER_OK))

    const registration = await registerSparkNostrIdentity({
      base: BASE,
      nostrPubkey: NOSTR_PUBKEY,
      nostrProof: PROOF,
      signMessage,
    })

    expect(registration.nip05).toBe("alice@blink.sv")
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(`https://blink.sv/lnurlpay/${SPARK_PUBKEY}/nostr`)
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body as string)
    expect(body.nostr_pubkey).toBe(NOSTR_PUBKEY)
    expect(body.nostr_proof).toBe(PROOF)
    expect(body.signature).toBe("deadbeef")
    // The seam was called with the exact canonical message (timestamp matches body).
    expect(signMessage).toHaveBeenCalledWith(
      signedNostrRegisterMessage(NOSTR_PUBKEY, body.timestamp),
    )
  })

  it("maps proof failures, auth failures, and rate limits to typed errors", async () => {
    mockFetch.mockReturnValue(errJson(400, "nostr proof lnaddress mismatch"))
    await expect(
      registerSparkNostrIdentity({
        base: BASE,
        nostrPubkey: NOSTR_PUBKEY,
        nostrProof: PROOF,
        signMessage,
      }),
    ).rejects.toMatchObject({ kind: "invalid-proof" })

    mockFetch.mockReturnValue(errJson(429, "rate_limited"))
    await expect(
      registerSparkNostrIdentity({
        base: BASE,
        nostrPubkey: NOSTR_PUBKEY,
        nostrProof: PROOF,
        signMessage,
      }),
    ).rejects.toMatchObject({ kind: "rate-limit" })

    mockFetch.mockRejectedValue(new Error("offline"))
    await expect(
      registerSparkNostrIdentity({
        base: BASE,
        nostrPubkey: NOSTR_PUBKEY,
        nostrProof: PROOF,
        signMessage,
      }),
    ).rejects.toBeInstanceOf(Nip05RegisterError)
  })
})

describe("registerBlinkNostrIdentity", () => {
  it("forwards the session token as a bearer and maps the response", async () => {
    mockFetch.mockReturnValue(okJson(SERVER_OK))

    const registration = await registerBlinkNostrIdentity({
      base: BASE,
      token: "jwt-token",
      nostrPubkey: NOSTR_PUBKEY,
      nostrProof: PROOF,
    })

    expect(registration).toEqual({
      username: "alice",
      domain: "blink.sv",
      nostrPubkey: NOSTR_PUBKEY,
      nip05: "alice@blink.sv",
    })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe("https://blink.sv/nostr/blink")
    expect(init.headers.Authorization).toBe("Bearer jwt-token")
    expect(JSON.parse(init.body as string).nostr_pubkey).toBe(NOSTR_PUBKEY)
  })

  it("maps 401 to unauthorized and 404 to not-provisioned", async () => {
    mockFetch.mockReturnValue(errJson(401, "invalid or expired token"))
    await expect(
      registerBlinkNostrIdentity({
        base: BASE,
        token: "bad",
        nostrPubkey: NOSTR_PUBKEY,
        nostrProof: PROOF,
      }),
    ).rejects.toMatchObject({ kind: "unauthorized" })

    mockFetch.mockReturnValue(errJson(404, "username not provisioned on this domain"))
    await expect(
      registerBlinkNostrIdentity({
        base: BASE,
        token: "good",
        nostrPubkey: NOSTR_PUBKEY,
        nostrProof: PROOF,
      }),
    ).rejects.toMatchObject({ kind: "not-provisioned" })
  })
})

describe("mergeProfileMetadata", () => {
  it("merges nip05 and lud16 without clobbering foreign fields", () => {
    const existing = JSON.stringify({
      name: "Alice",
      about: "hello",
      picture: "https://x/y.png",
    })

    const template = mergeProfileMetadata(existing, {
      nip05: "alice@blink.sv",
      lud16: "alice@blink.sv",
    })

    expect(template.kind).toBe(0)
    const meta = JSON.parse(template.content)
    expect(meta).toEqual({
      name: "Alice",
      about: "hello",
      picture: "https://x/y.png",
      nip05: "alice@blink.sv",
      lud16: "alice@blink.sv",
    })
  })

  it("starts fresh on malformed existing content and skips undefined updates", () => {
    const template = mergeProfileMetadata("not json", { nip05: "a@b.c" })
    const meta = JSON.parse(template.content)
    expect(meta).toEqual({ nip05: "a@b.c" })
  })
})
