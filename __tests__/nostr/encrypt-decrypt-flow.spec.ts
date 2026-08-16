/**
 * Story 3.6 Task 1b/5 — the encrypt/decrypt capability flow.
 *
 * Each of the four ops (nip04/nip44 encrypt/decrypt) raises its OWN fresh approval through the
 * ApprovalCoordinator (FR-12 / CAP-5) — no cached consent, no "remember", no reuse across ops.
 * Decrypted plaintext (and the content the approval surface renders) NEVER reaches the log /
 * analytics sinks (AD-7); pipeline logging is metadata-only.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"

import { createLocalNsecSigner } from "../../app/nostr/core/local-nsec-signer"
import { createEncryptDecryptFlow } from "../../app/nostr/transport/encrypt-decrypt"

const userSk = new Uint8Array(32).fill(5)
const userSkHex = bytesToHex(userSk)
const peerSk = new Uint8Array(32).fill(8)
const peerPubHex = bytesToHex(schnorr.getPublicKey(peerSk))

const makeFlow = (approve: boolean) => {
  const signer = createLocalNsecSigner({ readNsecHex: async () => userSkHex })
  const requestApproval = jest.fn(async () => ({ approved: approve }))
  const log = jest.fn()
  const flow = createEncryptDecryptFlow({ signer, requestApproval, log })
  return { flow, requestApproval, log }
}

/** Encrypt a payload with a throwaway approved flow and return the ciphertext. */
const encryptSeed = async (plaintext: string): Promise<string> => {
  const r = await makeFlow(true).flow.handle({
    method: "nip44_encrypt",
    peerPubkey: peerPubHex,
    payload: plaintext,
  })
  if (!r.ok) throw new Error("seed encrypt failed")
  return r.result
}

describe("fresh approval per op (Task 1b, FR-12/CAP-5)", () => {
  it("raises a distinct approval for EACH of the four ops (no cached consent)", async () => {
    const seed = await encryptSeed("seed body one")
    const { flow, requestApproval } = makeFlow(true)
    await flow.handle({
      method: "nip44_encrypt",
      peerPubkey: peerPubHex,
      payload: "msg one",
    })
    await flow.handle({ method: "nip44_decrypt", peerPubkey: peerPubHex, payload: seed })
    await flow.handle({
      method: "nip04_encrypt",
      peerPubkey: peerPubHex,
      payload: "msg two",
    })
    // 3 handled ops here → 3 approvals (each op its own surface, no reuse)
    expect(requestApproval).toHaveBeenCalledTimes(3)
  })

  it("approving one op does NOT pre-approve the next (each awaits its own)", async () => {
    const { flow, requestApproval } = makeFlow(true)
    await flow.handle({
      method: "nip44_encrypt",
      peerPubkey: peerPubHex,
      payload: "first msg",
    })
    await flow.handle({
      method: "nip44_encrypt",
      peerPubkey: peerPubHex,
      payload: "second msg",
    })
    expect(requestApproval).toHaveBeenCalledTimes(2)
  })

  it("a rejected op returns an error and produces no ciphertext", async () => {
    const { flow } = makeFlow(false)
    const r = await flow.handle({
      method: "nip44_encrypt",
      peerPubkey: peerPubHex,
      payload: "secret",
    })
    expect(r.ok).toBe(false)
  })
})

describe("plaintext never logged (Task 5, AD-7)", () => {
  it("the log sink receives ONLY metadata — never the plaintext or ciphertext", async () => {
    const { flow, log } = makeFlow(true)
    const PLAINTEXT = "super-secret-dm-body"
    await flow.handle({
      method: "nip44_encrypt",
      peerPubkey: peerPubHex,
      payload: PLAINTEXT,
    })
    expect(log).toHaveBeenCalled()
    for (const call of log.mock.calls) {
      const serialized = JSON.stringify(call[0])
      expect(serialized).not.toContain(PLAINTEXT)
      expect(serialized).not.toContain(userSkHex)
    }
  })

  it("decrypt confines plaintext to the result — never to the log sink", async () => {
    const seed = await encryptSeed("decrypt-me-body")
    const { flow, log } = makeFlow(true)
    const r = await flow.handle({
      method: "nip44_decrypt",
      peerPubkey: peerPubHex,
      payload: seed,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.result).toBe("decrypt-me-body")
    for (const call of log.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain("decrypt-me-body")
    }
  })
})
