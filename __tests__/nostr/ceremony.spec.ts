/**
 * Story 1.5 — creation-ceremony controller (core logic for Tasks 1/3/6).
 * Deliberate three steps, no auto-generation, fail-closed confirm, AD-9 exclusive
 * commit, non-blocking AD-12 npub push.
 */
import {
  initialCeremonyState,
  toConfirm,
  confirmCreate,
  retryAfterError,
  type CeremonyPorts,
} from "../../app/nostr/core/identity"

const PUB = "a".repeat(64)

const makePorts = (
  over: Partial<CeremonyPorts> = {},
): {
  ports: CeremonyPorts
  calls: Record<string, number>
  exclusiveWrapped: boolean[]
} => {
  const calls = { generateKey: 0, persistNsec: 0, commitIdentity: 0, pushNpub: 0 }
  const exclusiveWrapped: boolean[] = []
  const ports: CeremonyPorts = {
    generateKey: () => {
      calls.generateKey += 1
      return { privKeyHex: "1".repeat(64), pubKeyHex: PUB }
    },
    persistNsec: async () => {
      calls.persistNsec += 1
    },
    toNpub: (hex) => `npub_${hex.slice(0, 6)}`,
    runExclusive: async (commit) => {
      exclusiveWrapped.push(true)
      return commit()
    },
    commitIdentity: async () => {
      calls.commitIdentity += 1
      return 1
    },
    pushNpub: async () => {
      calls.pushNpub += 1
    },
    ...over,
  }
  return { ports, calls, exclusiveWrapped }
}

describe("deliberate flow, no auto-generation (AC-1/SM-C1)", () => {
  it("starts on intro with no identity and no key generated", () => {
    const s = initialCeremonyState()
    expect(s.step).toBe("intro")
    expect(s.identity).toBeNull()
  })

  it("intro -> confirm does NOT generate a key (agency step is deliberate)", () => {
    const { calls } = makePorts()
    const s = toConfirm(initialCeremonyState())
    expect(s.step).toBe("confirm")
    expect(calls.generateKey).toBe(0)
  })
})

describe("confirm: generate + commit + push (AC-1/AC-7)", () => {
  it("generates on confirm, commits inside the exclusive section, lands on result", async () => {
    const { ports, calls, exclusiveWrapped } = makePorts()
    const next = await confirmCreate(toConfirm(initialCeremonyState()), ports)

    expect(calls.generateKey).toBe(1)
    expect(calls.persistNsec).toBe(1)
    expect(calls.commitIdentity).toBe(1)
    expect(exclusiveWrapped).toEqual([true]) // commit ran inside runExclusive
    expect(next.step).toBe("result")
    expect(next.identity).toMatchObject({ pubKeyHex: PUB, epoch: 1 })
    expect(next.identity?.npub).toBe("npub_aaaaaa")
  })

  it("persist + commit happen INSIDE the exclusive section (order + wrapping)", async () => {
    const order: string[] = []
    const { ports } = makePorts({
      runExclusive: async (commit) => {
        order.push("exclusive:enter")
        const r = await commit()
        order.push("exclusive:exit")
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
    await confirmCreate(toConfirm(initialCeremonyState()), ports)
    expect(order).toEqual(["exclusive:enter", "persist", "commit", "exclusive:exit"])
  })
})

describe("fail-closed on CSPRNG failure (AC-1/AC-4)", () => {
  it("returns an error state with NO identity and NO persistence when keygen throws", async () => {
    const { ports, calls } = makePorts({
      generateKey: () => {
        throw new Error("CSPRNG unavailable")
      },
    })
    const next = await confirmCreate(toConfirm(initialCeremonyState()), ports)
    expect(next.step).toBe("error")
    expect(next.error?.code).toBe("unavailable")
    expect(next.identity).toBeNull()
    expect(calls.persistNsec).toBe(0)
    expect(calls.commitIdentity).toBe(0)
  })

  it("retryAfterError returns to confirm (Try Again)", () => {
    const errored = { step: "error" as const, identity: null, error: null }
    expect(retryAfterError(errored).step).toBe("confirm")
  })
})

describe("non-blocking npub push (AC-7/AD-12)", () => {
  it("a push rejection does NOT block or fail ceremony completion", async () => {
    const { ports } = makePorts({
      pushNpub: async () => {
        throw new Error("outbox offline")
      },
    })
    const next = await confirmCreate(toConfirm(initialCeremonyState()), ports)
    expect(next.step).toBe("result") // completed despite push failure
    expect(next.identity).not.toBeNull()
  })
})
