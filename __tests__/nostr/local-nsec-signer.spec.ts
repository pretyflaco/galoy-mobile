/**
 * Story 1.3 / AC-1 — LocalNsecSigner: sole nsec reader, BIP-340 Schnorr signatures
 * verifiable against the user npub, swappable behind the seam with zero consumer change.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { hexToBytes } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

import { createLocalNsecSigner } from "../../app/nostr/core/local-nsec-signer"
import type { NostrSigner, EventTemplate } from "../../app/nostr/core/signer"

// A fixed identity secret (valid secp256k1 scalar): 0x…05.
const NSEC_HEX = "0000000000000000000000000000000000000000000000000000000000000005"
const expectedXOnly = Buffer.from(schnorr.getPublicKey(hexToBytes(NSEC_HEX))).toString(
  "hex",
)

const template = (): EventTemplate => ({
  kind: 1,
  // eslint-disable-next-line camelcase
  created_at: 1_700_000_000,
  tags: [],
  content: "gm",
})

// nsec provider stands in for the keychain read (exercised for real in the keystore test).
const signer: NostrSigner = createLocalNsecSigner({
  readNsecHex: async () => NSEC_HEX,
})

describe("LocalNsecSigner — BIP-340 signing (AC-1)", () => {
  it("getPublicKey() returns the user npub for the stored nsec", async () => {
    const npub = await signer.getPublicKey()
    expect(npub).toBe(nip19.npubEncode(expectedXOnly))
  })

  it("signEvent() produces a Schnorr signature verifiable against the user pubkey", async () => {
    const signed = await signer.signEvent(template())
    expect(signed.pubkey).toBe(expectedXOnly)
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/)
    const ok = schnorr.verify(
      hexToBytes(signed.sig),
      hexToBytes(signed.id),
      hexToBytes(signed.pubkey),
    )
    expect(ok).toBe(true)
  })

  it("is cancellable — rejects with a typed aborted SignerError on an aborted signal", async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(signer.signEvent(template(), ac.signal)).rejects.toMatchObject({
      code: "aborted",
    })
  })

  it("capabilities report local custody (custodyLocal, single-party)", () => {
    expect(signer.capabilities.custodyLocal).toBe(true)
    expect(signer.capabilities.multiParty).toBe(false)
  })
})

describe("seam swappability (AC-1 / FR-1)", () => {
  // A trivial consumer that depends ONLY on the NostrSigner port.
  const getNpub = async (s: NostrSigner): Promise<string> => s.getPublicKey()

  it("a stub signer swaps behind the seam with zero consumer change", async () => {
    const stub: NostrSigner = {
      getPublicKey: async () => "npub-stub",
      signEvent: async (e) => ({ ...e, id: "i", pubkey: "p", sig: "s" }),
      nip04Encrypt: async (_p, x) => x,
      nip04Decrypt: async (_p, x) => x,
      nip44Encrypt: async (_p, x) => x,
      nip44Decrypt: async (_p, x) => x,
      capabilities: { custodyLocal: false, canBackup: false, multiParty: true },
    }
    expect(await getNpub(stub)).toBe("npub-stub")
    // the same consumer works against the real signer unchanged
    expect(await getNpub(signer)).toBe(nip19.npubEncode(expectedXOnly))
  })
})
