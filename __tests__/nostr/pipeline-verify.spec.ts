/**
 * Story 3.2 — pipeline verify-BEFORE-decrypt stage (AC #1, AD-16).
 *
 * The pipeline runs an EXPLICIT BIP-340 verification stage against the claimed author
 * clientPubkey FIRST. Decrypt/decode/dispatch never run for an event that failed
 * verification — it is dropped SILENTLY (no reply, metadata-only log). Order guarantee:
 * verify → decrypt → decode → dispatch.
 *
 * Framework-agnostic (transport, AD-1): the crypto verify + decode + dispatch are injected
 * ports so the test can prove ordering by spying on them.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { finalizeEvent, verifyEvent, type Event } from "nostr-tools/pure"

import { createInboundPipeline } from "../../app/nostr/transport/pipeline"
import { NIP46_KIND } from "../../app/nostr/transport/nip46-codec"

const clientSk = new Uint8Array(32).fill(3)
const clientPub = bytesToHex(schnorr.getPublicKey(clientSk))

/**
 * Events arrive over the wire as plain JSON — never carrying nostr-tools' internal
 * verifiedSymbol cache. Round-trip through JSON so verifyEvent does a REAL BIP-340 check
 * (the whole point of the explicit verify stage: never trust an implicit "already verified"
 * flag on inbound traffic).
 */
const asWireEvent = (event: Event): Event => JSON.parse(JSON.stringify(event))

const validEvent = (): Event =>
  asWireEvent(
    finalizeEvent(
      {
        kind: NIP46_KIND,
        // eslint-disable-next-line camelcase
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", "deadbeef"]],
        content: "ciphertext-goes-here",
      },
      clientSk,
    ),
  )

const makePipeline = () => {
  const decode = jest.fn(() => ({
    clientPubkey: clientPub,
    scheme: "nip44" as const,
    request: { id: "r1", method: "ping", params: [] },
  }))
  const dispatch = jest.fn(async () => undefined)
  const log = jest.fn()
  const pipeline = createInboundPipeline({
    verify: verifyEvent,
    decode,
    dispatch,
    log,
  })
  return { pipeline, decode, dispatch, log }
}

describe("verify BEFORE decrypt (AC #1 / AD-16)", () => {
  it("a valid-signature event proceeds past verification to decrypt/decode + dispatch", async () => {
    const { pipeline, decode, dispatch } = makePipeline()
    await pipeline.handleInbound(validEvent())
    expect(decode).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it("a tampered/invalid-signature event is dropped and NEVER reaches decrypt", async () => {
    const { pipeline, decode, dispatch, log } = makePipeline()
    const tampered = { ...validEvent(), content: "tampered-after-signing" }
    await pipeline.handleInbound(tampered)
    expect(decode).not.toHaveBeenCalled() // decrypt/decode never runs
    expect(dispatch).not.toHaveBeenCalled()
    // dropped silently: no reply; only a metadata-only log entry
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ dropped: "verify-failed" }),
    )
  })

  it("enforces order verify → decode → dispatch (decode only after verify passes)", async () => {
    const order: string[] = []
    const pipeline = createInboundPipeline({
      verify: (e) => {
        order.push("verify")
        return verifyEvent(e)
      },
      decode: () => {
        order.push("decode")
        return {
          clientPubkey: clientPub,
          scheme: "nip44" as const,
          request: { id: "r1", method: "ping", params: [] },
        }
      },
      dispatch: async () => {
        order.push("dispatch")
      },
      log: jest.fn(),
    })
    await pipeline.handleInbound(validEvent())
    expect(order).toEqual(["verify", "decode", "dispatch"])
  })

  it("drops a wrong-kind event without decode or dispatch", async () => {
    const { pipeline, decode, dispatch } = makePipeline()
    const wrongKind = asWireEvent(
      // eslint-disable-next-line camelcase
      finalizeEvent({ kind: 1, created_at: 1, tags: [], content: "x" }, clientSk),
    )
    await pipeline.handleInbound(wrongKind)
    expect(decode).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })
})
