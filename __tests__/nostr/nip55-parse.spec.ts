/**
 * NIP-55 parsing (fail-closed): data-URI decoding (percent + literal-plus guard), the
 * permissions gate (ONLY sign_event:27235 is grantable over NIP-55), current_user
 * normalization (hex or npub → x-only hex), and unsigned-event coercion into the SAME
 * RawSignEventParams the NIP-46 path normalizes.
 */
import * as nip19 from "nostr-tools/nip19"

import {
  coerceSignEventParams,
  decodeNip55Data,
  parseNip55Permissions,
  parseNip55Request,
  pseudoClientKey,
  rejectionForType,
  toHexPubkey,
} from "../../app/nostr/nip55/parse"

const USER_PUB = "ab".repeat(32)

const encodeDataUri = (json: string): string => `nostrsigner:${encodeURIComponent(json)}`

describe("decodeNip55Data", () => {
  it("decodes a percent-encoded payload (vezir Uri.encode form)", () => {
    const json = JSON.stringify({ id: "x", kind: 27235, content: "" })
    expect(decodeNip55Data(`nostrsigner:${encodeURIComponent(json)}`)).toBe(json)
  })

  it("treats a raw + as a literal plus, never a space (Amber guard parity)", () => {
    expect(decodeNip55Data("nostrsigner:a%2Bb")).toBe("a+b")
    expect(decodeNip55Data("nostrsigner:a+b+c")).toBe("a+b+c")
  })

  it("returns null on malformed percent-encoding", () => {
    expect(decodeNip55Data("nostrsigner:%E0%A4%A")).toBeNull()
  })
})

describe("toHexPubkey", () => {
  it("lowercases a 64-hex key", () => {
    expect(toHexPubkey("AB".repeat(32))).toBe(USER_PUB)
  })

  it("decodes an npub to x-only hex", () => {
    expect(toHexPubkey(nip19.npubEncode(USER_PUB))).toBe(USER_PUB)
  })

  it("rejects anything else", () => {
    expect(toHexPubkey("npub1notvalid")).toBeNull()
    expect(toHexPubkey("zz".repeat(32))).toBeNull()
    expect(toHexPubkey("")).toBeNull()
  })
})

describe("parseNip55Permissions (fail-closed gate)", () => {
  it("accepts exactly the grantable login-sign permission vezir requests", () => {
    expect(parseNip55Permissions('[{"type":"sign_event","kind":27235}]')).toEqual([
      { type: "sign_event", kind: 27235 },
    ])
  })

  it("allows a missing/empty permissions list (bare pubkey share)", () => {
    expect(parseNip55Permissions(undefined)).toEqual([])
    expect(parseNip55Permissions(null)).toEqual([])
    expect(parseNip55Permissions("[]")).toEqual([])
  })

  it("rejects any permission outside the grantable set", () => {
    expect(parseNip55Permissions('[{"type":"sign_event","kind":22242}]')).toBeNull()
    expect(parseNip55Permissions('[{"type":"nip04_encrypt"}]')).toBeNull()
    expect(parseNip55Permissions('[{"type":"sign_event"}]')).toBeNull()
  })

  it("rejects malformed JSON / non-array shapes", () => {
    expect(parseNip55Permissions("not json")).toBeNull()
    expect(parseNip55Permissions('{"type":"sign_event"}')).toBeNull()
    expect(parseNip55Permissions("[42]")).toBeNull()
  })
})

describe("coerceSignEventParams", () => {
  it("accepts a well-formed unsigned event and carries the untrusted fields", () => {
    const params = coerceSignEventParams({
      id: "id-from-client",
      pubkey: USER_PUB,
      // eslint-disable-next-line camelcase
      created_at: 1_800_000_000,
      kind: 27235,
      tags: [
        ["u", "https://vezir.twentyone.ist/api/auth/nostr/login"],
        ["method", "POST"],
      ],
      content: "",
    })
    expect(params).toEqual({
      kind: 27235,
      content: "",
      tags: [
        ["u", "https://vezir.twentyone.ist/api/auth/nostr/login"],
        ["method", "POST"],
      ],
      // eslint-disable-next-line camelcase
      created_at: 1_800_000_000,
      pubkey: USER_PUB,
      id: "id-from-client",
    })
  })

  it("rejects malformed shapes (fail-closed)", () => {
    expect(coerceSignEventParams({ kind: "27235", content: "" })).toBeNull()
    expect(coerceSignEventParams({ kind: 27235, tags: "x" })).toBeNull()
    expect(coerceSignEventParams({ kind: 27235, tags: [["u", 5]] })).toBeNull()
    expect(coerceSignEventParams(null)).toBeNull()
    expect(coerceSignEventParams("string")).toBeNull()
  })
})

describe("parseNip55Request", () => {
  it("parses a get_public_key login request", () => {
    expect(
      parseNip55Request({
        type: "get_public_key",
        id: "req-1",
        permissions: '[{"type":"sign_event","kind":27235}]',
        callerPackage: "com.vezir.android",
      }),
    ).toEqual({
      type: "get_public_key",
      permissions: [{ type: "sign_event", kind: 27235 }],
    })
  })

  it("parses a sign_event request: encoded event JSON + hex current_user", () => {
    const event = {
      id: "cafe".repeat(16),
      pubkey: USER_PUB,
      // eslint-disable-next-line camelcase
      created_at: 1_800_000_000,
      kind: 27235,
      tags: [
        ["u", "https://vezir.twentyone.ist/api/auth/nostr/login"],
        ["method", "POST"],
      ],
      content: "",
    }
    const parsed = parseNip55Request({
      type: "sign_event",
      id: "req-2",
      data: encodeDataUri(JSON.stringify(event)),
      currentUser: USER_PUB.toUpperCase(),
    })
    expect(parsed).toEqual({
      type: "sign_event",
      params: expect.objectContaining({
        kind: 27235,
        // eslint-disable-next-line camelcase
        created_at: 1_800_000_000,
      }),
      currentUserHex: USER_PUB,
    })
  })

  it("accepts an npub current_user", () => {
    const event = { kind: 27235, content: "", tags: [] }
    const parsed = parseNip55Request({
      type: "sign_event",
      data: encodeDataUri(JSON.stringify(event)),
      currentUser: nip19.npubEncode(USER_PUB),
    })
    expect(parsed && "currentUserHex" in parsed && parsed.currentUserHex).toBe(USER_PUB)
  })

  it("rejects: unknown type, missing data, bad JSON, missing/invalid current_user", () => {
    expect(parseNip55Request({ type: "nip04_encrypt" })).toBeNull()
    expect(parseNip55Request({ type: "sign_event", currentUser: USER_PUB })).toBeNull()
    expect(
      parseNip55Request({
        type: "sign_event",
        data: "nostrsigner:not-json",
        currentUser: USER_PUB,
      }),
    ).toBeNull()
    expect(
      parseNip55Request({
        type: "sign_event",
        data: encodeDataUri('{"kind":27235,"content":""}'),
      }),
    ).toBeNull()
    expect(
      parseNip55Request({
        type: "sign_event",
        data: encodeDataUri('{"kind":27235,"content":""}'),
        currentUser: "nope",
      }),
    ).toBeNull()
  })
})

describe("rejection mapping + pseudo client keys", () => {
  it("maps per-type rejections (login cancels, sign flags)", () => {
    expect(rejectionForType({ type: "get_public_key", id: "r1" })).toEqual({
      kind: "login_reject",
      id: "r1",
    })
    expect(rejectionForType({ type: "sign_event", id: "r2" })).toEqual({
      kind: "sign_reject",
      id: "r2",
    })
    // Unknown types fall back to the login (cancel) form.
    expect(rejectionForType({ type: "nip04_encrypt" })).toEqual({ kind: "login_reject" })
  })

  it("derives non-colliding pseudo client keys (never 64-hex)", () => {
    expect(pseudoClientKey("com.vezir.android")).toBe("nip55:com.vezir.android")
    expect(pseudoClientKey(null)).toBe("nip55:unknown")
    expect(pseudoClientKey("com.vezir.android")).not.toMatch(/^[0-9a-f]{64}$/)
  })
})
