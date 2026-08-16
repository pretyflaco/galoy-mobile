/**
 * Story 3.2 — NIP-46 kind-24133 codec + respond-in-kind encryption detection (AC #2, AD-10).
 *
 * decodeRequest detects each inbound payload's scheme (NIP-44 vs legacy NIP-04) and returns
 * it alongside the decoded {id, method, params}; encodeResponse replies in the SAME scheme
 * the request arrived in. The signer NEVER initiates/advertises NIP-04 — a signer-INITIATED
 * message path is always NIP-44. Transport encryption uses the device-local transport keypair
 * (AD-4), distinct from the identity key.
 *
 * Framework-agnostic (transport, AD-1): keys are provided in-test; no keychain, no relay.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { finalizeEvent } from "nostr-tools/pure"
import * as nip04 from "nostr-tools/nip04"
import * as nip44 from "nostr-tools/nip44"

import {
  decodeRequest,
  encodeResponse,
  detectScheme,
  NIP46_KIND,
} from "../../app/nostr/transport/nip46-codec"

// A client keypair and the signer's device-local transport keypair (AD-4).
const clientSk = new Uint8Array(32).fill(7)
const clientPub = bytesToHex(schnorr.getPublicKey(clientSk))
const transportSk = new Uint8Array(32).fill(11)
const transportPub = bytesToHex(schnorr.getPublicKey(transportSk))

/** Build a kind-24133 request event carrying an encrypted {id, method, params} payload. */
const buildRequest = (
  scheme: "nip04" | "nip44",
  body: { id: string; method: string; params: string[] },
) => {
  const json = JSON.stringify(body)
  const content =
    scheme === "nip04"
      ? nip04.encrypt(clientSk, transportPub, json)
      : nip44.encrypt(json, nip44.getConversationKey(clientSk, transportPub))
  return finalizeEvent(
    {
      kind: NIP46_KIND,
      // eslint-disable-next-line camelcase
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", transportPub]],
      content,
    },
    clientSk,
  )
}

describe("scheme detection (AD-10)", () => {
  it("detects legacy NIP-04 by its ?iv= marker and NIP-44 otherwise", () => {
    const nip04Cipher = nip04.encrypt(clientSk, transportPub, "hi")
    const nip44Cipher = nip44.encrypt(
      "hi",
      nip44.getConversationKey(clientSk, transportPub),
    )
    expect(detectScheme(nip04Cipher)).toBe("nip04")
    expect(detectScheme(nip44Cipher)).toBe("nip44")
  })
})

describe("decodeRequest (AC #2)", () => {
  it("decodes a NIP-44 request and reports scheme nip44", () => {
    const evt = buildRequest("nip44", { id: "r1", method: "ping", params: [] })
    const decoded = decodeRequest(evt, transportSk)
    expect(decoded).toMatchObject({
      scheme: "nip44",
      clientPubkey: clientPub,
      request: { id: "r1", method: "ping", params: [] },
    })
  })

  it("decodes a legacy NIP-04 request and reports scheme nip04", () => {
    const evt = buildRequest("nip04", {
      id: "r2",
      method: "get_public_key",
      params: [],
    })
    const decoded = decodeRequest(evt, transportSk)
    expect(decoded.scheme).toBe("nip04")
    expect(decoded.request).toMatchObject({ id: "r2", method: "get_public_key" })
  })

  it("preserves the requestId and method verbatim from the inbound message", () => {
    const evt = buildRequest("nip44", {
      id: "VERBATIM-42",
      method: "connect",
      params: ["a", "b"],
    })
    const decoded = decodeRequest(evt, transportSk)
    expect(decoded.request.id).toBe("VERBATIM-42")
    expect(decoded.request.method).toBe("connect")
    expect(decoded.request.params).toEqual(["a", "b"])
  })
})

describe("encodeResponse respond-in-kind (AC #2 / AD-10)", () => {
  const roundTripResponse = (scheme: "nip04" | "nip44") => {
    const evt = encodeResponse(
      { id: "r1", result: "pong" },
      { scheme, clientPubkey: clientPub, transportSk },
    )
    expect(evt.kind).toBe(NIP46_KIND)
    expect(evt.tags).toContainEqual(["p", clientPub]) // addressed back to the client
    // the response decrypts back with the SAME scheme the request used
    const plaintext =
      scheme === "nip04"
        ? nip04.decrypt(clientSk, transportPub, evt.content)
        : nip44.decrypt(evt.content, nip44.getConversationKey(clientSk, transportPub))
    return JSON.parse(plaintext)
  }

  it("responds NIP-44 to a NIP-44 request", () => {
    expect(roundTripResponse("nip44")).toMatchObject({ id: "r1", result: "pong" })
  })

  it("responds NIP-04 to a NIP-04 request (respond-in-kind only)", () => {
    expect(roundTripResponse("nip04")).toMatchObject({ id: "r1", result: "pong" })
  })

  it("carries the spec `error` field when the response is an error", () => {
    const evt = encodeResponse(
      { id: "r9", error: "unknown method" },
      { scheme: "nip44", clientPubkey: clientPub, transportSk },
    )
    const decoded = JSON.parse(
      nip44.decrypt(evt.content, nip44.getConversationKey(clientSk, transportPub)),
    )
    expect(decoded).toMatchObject({ id: "r9", error: "unknown method" })
  })
})
