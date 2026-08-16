/**
 * Story 3.5 Task 2 — parse-stage event normalization for sign_event (AC #2, AD-16).
 *
 * The parse stage, in order: strip `sig`; reject a client `pubkey` that mismatches the user
 * npub with a spec error and NO approval raised; recompute `id` unconditionally; default a
 * missing `created_at` to now. Output is a canonical UnsignedEvent — the seam may ASSERT but
 * never repair. Rejection happens in the parse stage, BEFORE the approval surface.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { getEventHash } from "nostr-tools/pure"
import * as nip19 from "nostr-tools/nip19"

import {
  normalizeSignEventParams,
  type NormalizeResult,
} from "../../app/nostr/transport/sign-event"

const userSk = new Uint8Array(32).fill(4)
const userPubHex = bytesToHex(schnorr.getPublicKey(userSk))
const userNpub = nip19.npubEncode(userPubHex)

const NOW = 1_800_000_000
const nowFn = () => NOW

const okOf = (r: NormalizeResult) => {
  if (r.ok !== true) throw new Error("expected ok result")
  return r.event
}

describe("sign_event normalization (AC #2)", () => {
  it("strips any client-supplied sig", () => {
    const r = normalizeSignEventParams(
      // eslint-disable-next-line camelcase
      { kind: 1, created_at: NOW, tags: [], content: "hi", sig: "deadbeef" },
      { userNpub, now: nowFn },
    )
    expect(okOf(r)).not.toHaveProperty("sig")
  })

  it("recomputes id unconditionally (a wrong client id is ignored)", () => {
    const r = normalizeSignEventParams(
      // eslint-disable-next-line camelcase
      { kind: 1, created_at: NOW, tags: [], content: "hi", id: "0".repeat(64) },
      { userNpub, now: nowFn },
    )
    const event = okOf(r)
    const expectedId = getEventHash({
      kind: 1,
      // eslint-disable-next-line camelcase
      created_at: NOW,
      tags: [],
      content: "hi",
      pubkey: userPubHex,
    })
    expect(event.id).toBe(expectedId)
    expect(event.id).not.toBe("0".repeat(64))
  })

  it("defaults a missing created_at to now", () => {
    const r = normalizeSignEventParams(
      { kind: 1, tags: [], content: "hi" },
      { userNpub, now: nowFn },
    )
    expect(okOf(r).created_at).toBe(NOW)
  })

  it("sets pubkey to the user's x-only hex derived from the npub", () => {
    const r = normalizeSignEventParams(
      { kind: 1, tags: [], content: "hi" },
      { userNpub, now: nowFn },
    )
    expect(okOf(r).pubkey).toBe(userPubHex)
  })

  it("rejects a client pubkey that mismatches the user npub (spec error, NO approval)", () => {
    const otherPub = bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(9)))
    const r = normalizeSignEventParams(
      { kind: 1, tags: [], content: "hi", pubkey: otherPub },
      { userNpub, now: nowFn },
    )
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(typeof r.error).toBe("string")
  })

  it("accepts a client pubkey that MATCHES the user (hex form)", () => {
    const r = normalizeSignEventParams(
      { kind: 1, tags: [], content: "hi", pubkey: userPubHex },
      { userNpub, now: nowFn },
    )
    expect(r.ok).toBe(true)
  })

  it("produces a canonical UnsignedEvent with all NIP-01 fields", () => {
    const event = okOf(
      normalizeSignEventParams(
        { kind: 30023, tags: [["d", "x"]], content: "post" },
        { userNpub, now: nowFn },
      ),
    )
    expect(event).toMatchObject({
      kind: 30023,
      // eslint-disable-next-line camelcase
      created_at: NOW,
      tags: [["d", "x"]],
      content: "post",
      pubkey: userPubHex,
    })
    expect(typeof event.id).toBe("string")
  })
})
