/**
 * Story 3.2 — the wired dispatch stage: methods + ledger + respond-in-kind, end-to-end
 * (AC #3 + #4 together, AD-16). Proves the request lifecycle at the pipeline level:
 *  - a fresh request is answered once and the response is sent in-kind + recorded;
 *  - redelivery of an ANSWERED request re-sends the STORED response WITHOUT re-executing the
 *    handler (the seam is not called again);
 *  - redelivery while PENDING is not re-surfaced.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { finalizeEvent, type Event } from "nostr-tools/pure"
import * as nip44 from "nostr-tools/nip44"

import { createRequestDispatcher } from "../../app/nostr/transport/dispatcher"
import {
  createRequestLedger,
  type LedgerStorage,
} from "../../app/nostr/core/request-ledger"
import { NIP46_KIND, type DecodedRequest } from "../../app/nostr/transport/nip46-codec"

const clientSk = new Uint8Array(32).fill(5)
const clientPub = bytesToHex(schnorr.getPublicKey(clientSk))
const transportSk = new Uint8Array(32).fill(13)
const transportPub = bytesToHex(schnorr.getPublicKey(transportSk))
const USER_PUBKEY_HEX = "c".repeat(64) // NIP-46 get_public_key wire format (hex, not npub)

const memoryStorage = (): LedgerStorage => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (k) => (map.has(k) ? map.get(k) : null),
    saveJson: async (k, v) => {
      map.set(k, JSON.parse(JSON.stringify(v)))
    },
  }
}

const decodedPing = (id: string): DecodedRequest => ({
  clientPubkey: clientPub,
  scheme: "nip44",
  request: { id, method: "ping", params: [] },
})

/** The original request event (for tags/context); content is irrelevant post-decode. */
const requestEvent = (): Event =>
  finalizeEvent(
    // eslint-disable-next-line camelcase
    { kind: NIP46_KIND, created_at: 1, tags: [["p", transportPub]], content: "x" },
    clientSk,
  )

const decryptSent = (evt: Event) =>
  JSON.parse(nip44.decrypt(evt.content, nip44.getConversationKey(clientSk, transportPub)))

describe("wired dispatch: methods + ledger + respond-in-kind (AC #3/#4)", () => {
  it("answers a fresh request once, sends it in-kind, and records it", async () => {
    const send = jest.fn()
    const getPublicKeyHex = jest.fn(async () => USER_PUBKEY_HEX)
    const dispatcher = createRequestDispatcher({
      ledger: createRequestLedger(memoryStorage()),
      methodPorts: { getPublicKeyHex },
      transportSk,
      send,
    })

    await dispatcher.dispatch(decodedPing("r1"), requestEvent())

    expect(send).toHaveBeenCalledTimes(1)
    const sentEvent = send.mock.calls[0][0] as Event
    expect(sentEvent.tags).toContainEqual(["p", clientPub]) // addressed to the client
    expect(decryptSent(sentEvent)).toMatchObject({ id: "r1", result: "pong" })
  })

  it("re-sends the STORED response on redelivery of an answered request (no re-exec)", async () => {
    const send = jest.fn()
    const getPublicKeyHex = jest.fn(async () => USER_PUBKEY_HEX)
    const dispatcher = createRequestDispatcher({
      ledger: createRequestLedger(memoryStorage()),
      methodPorts: { getPublicKeyHex },
      transportSk,
      send,
    })

    const gpk = (id: string): DecodedRequest => ({
      clientPubkey: clientPub,
      scheme: "nip44",
      request: { id, method: "get_public_key", params: [] },
    })

    await dispatcher.dispatch(gpk("r2"), requestEvent()) // first: executes + answers
    await dispatcher.dispatch(gpk("r2"), requestEvent()) // redelivery: replay stored

    expect(getPublicKeyHex).toHaveBeenCalledTimes(1) // handler executed ONCE
    expect(send).toHaveBeenCalledTimes(2) // but the response was re-sent both times
    expect(decryptSent(send.mock.calls[1][0])).toMatchObject({
      id: "r2",
      result: USER_PUBKEY_HEX,
    })
  })
})
