/**
 * Story 3.5 Task 1/3 — sign_event flow: normalize → approve → seam sign → verify.
 *
 * Signing is behind a fresh approval (except the connect-time grant), goes ONLY through the
 * NostrSigner seam (LocalNsecSigner does the BIP-340 Schnorr), works for ANY kind, and the
 * returned event verifies against the user npub with standard nostr tooling. A pubkey mismatch
 * rejects in the parse stage with NO approval raised. Interop is exercised in-process against
 * nostr-tools verifyEvent (the reference verifier).
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { verifyEvent } from "nostr-tools/pure"
import * as nip19 from "nostr-tools/nip19"
import Crypto from "react-native-quick-crypto"

import { createLocalNsecSigner } from "../../app/nostr/core/local-nsec-signer"
import { createSignEventFlow } from "../../app/nostr/transport/sign-event"

const userSk = new Uint8Array(32).fill(4)
const userSkHex = bytesToHex(userSk)
const userPubHex = bytesToHex(schnorr.getPublicKey(userSk))
const userNpub = nip19.npubEncode(userPubHex)
const NOW = 1_800_000_000

const makeFlow = (approve: boolean) => {
  const signer = createLocalNsecSigner({ readNsecHex: async () => userSkHex })
  const requestApproval = jest.fn(async () => ({ approved: approve }))
  return {
    requestApproval,
    flow: createSignEventFlow({
      signer,
      userNpub,
      now: () => NOW,
      requestApproval,
    }),
  }
}

describe("sign_event flow (AC #1)", () => {
  it("signs an arbitrary kind and the result verifies against the user npub", async () => {
    const { flow } = makeFlow(true)
    const result = await flow.handle({ kind: 30023, tags: [], content: "post" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(verifyEvent(result.event)).toBe(true) // reference verifier
      expect(result.event.pubkey).toBe(userPubHex)
      expect(result.event.kind).toBe(30023)
    }
  })

  it("draws Schnorr auxRand from quick-crypto (spy), not a library default", async () => {
    // Spy while PRESERVING the deterministic mock behavior (Buffer.alloc(size, 0xab)) so the
    // shared quick-crypto mock is not corrupted for later tests.
    const randomBytes = Crypto.randomBytes as jest.Mock
    const spy = jest
      .spyOn(Crypto, "randomBytes")
      .mockImplementation((size: number) => Buffer.alloc(size, 0xab))
    const { flow } = makeFlow(true)
    await flow.handle({ kind: 1, tags: [], content: "hi" })
    expect(spy).toHaveBeenCalled() // auxRand came through the injected CSPRNG
    spy.mockRestore()
    // Restore the default deterministic mock impl for subsequent tests.
    randomBytes.mockImplementation((size: number) => Buffer.alloc(size, 0xab))
  })

  it("works for kind-22242 (auth challenge) — no kind allow-list", async () => {
    const { flow } = makeFlow(true)
    const result = await flow.handle({
      kind: 22242,
      tags: [
        ["relay", "wss://r"],
        ["challenge", "abc"],
      ],
      content: "",
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(verifyEvent(result.event)).toBe(true)
  })

  it("rejects a pubkey mismatch in the parse stage — NO approval raised", async () => {
    const otherPub = bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(9)))
    const { flow, requestApproval } = makeFlow(true)
    const result = await flow.handle({
      kind: 1,
      tags: [],
      content: "hi",
      pubkey: otherPub,
    })
    expect(result.ok).toBe(false)
    expect(requestApproval).not.toHaveBeenCalled() // rejected before the surface
  })

  it("returns a spec error and does NOT sign when the user rejects the approval", async () => {
    const { flow, requestApproval } = makeFlow(false)
    const result = await flow.handle({ kind: 1, tags: [], content: "hi" })
    expect(requestApproval).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
  })
})

describe("kind-22242 end-to-end interop (AC #3, SM-2)", () => {
  it("normalize → approve → seam sign → verify against the user npub (reference tooling)", async () => {
    const { flow } = makeFlow(true)
    // A blink-terminal-style auth challenge (kind 22242) with relay + challenge tags.
    const result = await flow.handle({
      kind: 22242,
      tags: [
        ["relay", "wss://relay.example"],
        ["challenge", "server-issued-nonce"],
      ],
      content: "",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Standard nostr tooling verifies the signature against the user's key.
      expect(verifyEvent(result.event)).toBe(true)
      const recoveredNpub = nip19.npubEncode(result.event.pubkey)
      expect(recoveredNpub).toBe(userNpub)
    }
  })
})
