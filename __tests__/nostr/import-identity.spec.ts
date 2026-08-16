/**
 * Story 1.6 — nsec import / replace identity (core logic: Tasks 2/4/5/6).
 * Validation via nip19.decode; invalid ⇒ error + NO state change. Commit replaces the
 * identity (discard, not archive), inside the AD-9 exclusive section with an epoch bump;
 * npub push is monotonic + non-blocking.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

import {
  validateNsec,
  importIdentity,
  executeIfEpochCurrent,
  type ImportPorts,
} from "../../app/nostr/core/identity"

const sk = new Uint8Array(32)
sk[31] = 7
const NSEC = nip19.nsecEncode(sk)
const NSEC_HEX = bytesToHex(sk)
const PUB_HEX = bytesToHex(schnorr.getPublicKey(sk))
const NPUB = nip19.npubEncode(PUB_HEX)

const makePorts = (over: Partial<ImportPorts> = {}) => {
  const state = {
    stored: "OLD_KEY",
    epoch: 1,
    pushed: [] as { npub: string; seq: number }[],
  }
  const exclusive: string[] = []
  const ports: ImportPorts = {
    persistNsec: async (hex) => {
      state.stored = hex
    },
    derivePubKeyHex: (privHex) =>
      bytesToHex(schnorr.getPublicKey(Uint8Array.from(Buffer.from(privHex, "hex")))),
    toNpub: (pubHex) => nip19.npubEncode(pubHex),
    runExclusive: async (commit) => {
      exclusive.push("enter")
      const r = await commit()
      exclusive.push("exit")
      return r
    },
    commitIdentity: async () => {
      state.epoch += 1
      return state.epoch
    },
    pushNpub: async (npub, seq) => {
      state.pushed.push({ npub, seq })
    },
    ...over,
  }
  return { ports, state, exclusive }
}

const deriveNpub = (privHex: string): string =>
  nip19.npubEncode(
    bytesToHex(schnorr.getPublicKey(Uint8Array.from(Buffer.from(privHex, "hex")))),
  )

describe("validateNsec (AC-2)", () => {
  it("accepts a well-formed nsec and returns its hex + npub", () => {
    const r = validateNsec(NSEC, deriveNpub)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.privKeyHex).toBe(NSEC_HEX)
      expect(r.npub).toBe(NPUB)
    }
  })

  it("rejects a non-nsec bech32 (npub) with no throw", () => {
    const r = validateNsec(NPUB, deriveNpub)
    expect(r.ok).toBe(false)
  })

  it("rejects malformed / non-bech32 input", () => {
    expect(validateNsec("nsec1badchecksum", deriveNpub).ok).toBe(false)
    expect(validateNsec("not-bech32-at-all", deriveNpub).ok).toBe(false)
    expect(validateNsec("", deriveNpub).ok).toBe(false)
  })
})

describe("importIdentity commit (AC-3/AC-4/AC-5)", () => {
  it("stores the imported nsec and discards the replaced key (no archive)", async () => {
    const { ports, state } = makePorts()
    const result = await importIdentity(NSEC_HEX, ports)
    expect(state.stored).toBe(NSEC_HEX) // replaced, single slot
    expect(result.identity.npub).toBe(NPUB)
    expect(result.identity.epoch).toBe(2)
  })

  it("commits inside the AD-9 exclusive section and bumps the epoch (N -> N+1)", async () => {
    const { ports, exclusive, state } = makePorts()
    const before = state.epoch
    const result = await importIdentity(NSEC_HEX, ports)
    expect(exclusive).toEqual(["enter", "exit"])
    expect(result.identity.epoch).toBe(before + 1)
  })

  it("persist + commit both run INSIDE the exclusive section", async () => {
    const order: string[] = []
    const { ports } = makePorts({
      runExclusive: async (commit) => {
        order.push("enter")
        const r = await commit()
        order.push("exit")
        return r
      },
      persistNsec: async () => {
        order.push("persist")
      },
      commitIdentity: async () => {
        order.push("commit")
        return 2
      },
    })
    await importIdentity(NSEC_HEX, ports)
    expect(order).toEqual(["enter", "persist", "commit", "exit"])
  })
})

describe("executor epoch re-check (AC-4/AD-9)", () => {
  it("executes a request approved under the current epoch", () => {
    const run = jest.fn(() => "signed")
    const r = executeIfEpochCurrent(2, 2, run)
    expect(r).toEqual({ executed: true, value: "signed" })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("DROPS a request approved against identity N after mutation to N+1", () => {
    const run = jest.fn(() => "signed")
    const r = executeIfEpochCurrent(2, 3, run) // approved@2, now@3
    expect(r).toEqual({ executed: false, reason: "stale-epoch" })
    expect(run).not.toHaveBeenCalled() // never executes against the new identity
  })
})

describe("monotonic non-blocking npub push (AC-6/AD-12)", () => {
  it("pushes the npub with a monotonically increasing seq", async () => {
    const seqs: number[] = []
    const { ports } = makePorts({
      pushNpub: async (_npub, seq) => {
        seqs.push(seq)
      },
    })
    await importIdentity(NSEC_HEX, ports)
    await importIdentity(NSEC_HEX, ports)
    expect(seqs).toHaveLength(2)
    expect(seqs[1]).toBeGreaterThan(seqs[0])
  })

  it("a push rejection does NOT block or fail import completion", async () => {
    const { ports } = makePorts({
      pushNpub: async () => {
        throw new Error("outbox offline")
      },
    })
    const result = await importIdentity(NSEC_HEX, ports)
    expect(result.identity.npub).toBe(NPUB) // completed despite push failure
  })
})
