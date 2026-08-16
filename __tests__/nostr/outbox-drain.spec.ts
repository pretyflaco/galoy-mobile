/**
 * Story 2.2 — idempotent drain with fresh proof-of-possession (CAP-8 / AD-12 / A7).
 *
 * The drain reads the pending outbox entry, obtains a FRESH server-issued challenge AT DRAIN
 * time, signs it via the NostrSigner seam, and pushes `{npub, challenge, proof}` via an
 * injected push port (unfrozen joint contract — tested against a mock, not a live endpoint).
 * Idempotent, supersede-safe, capped backoff, endpoint-absent graceful re-queue, never blocks.
 */
import {
  createOutboxDrain,
  type PushPort,
  type PushResult,
} from "../../app/nostr/core/outbox-drain"
import {
  createPersistentNpubOutbox,
  type OutboxStorage,
} from "../../app/nostr/core/outbox"

const makeMemStorage = (): OutboxStorage & { map: Map<string, unknown> } => {
  const map = new Map<string, unknown>()
  return {
    map,
    loadJson: async (key) => (map.has(key) ? map.get(key) : null),
    saveJson: async (key, value) => {
      map.set(key, JSON.parse(JSON.stringify(value)))
    },
  }
}

/** A fresh challenge counter so each getChallenge call yields a distinct value. */
const makeChallengeSource = () => {
  let n = 0
  const calls: string[] = []
  return {
    calls,
    getChallenge: async (npub: string): Promise<string> => {
      n += 1
      const challenge = `challenge-${npub}-${n}`
      calls.push(challenge)
      return challenge
    },
  }
}

/** signChallenge port: records what it signed; returns a deterministic proof. */
const makeSigner = () => {
  const signed: string[] = []
  return {
    signed,
    signChallenge: async (challenge: string): Promise<string> => {
      signed.push(challenge)
      return `proof(${challenge})`
    },
  }
}

const okPush = (): {
  port: PushPort
  received: Array<{ npub: string; challenge: string; proof: string }>
} => {
  const received: Array<{ npub: string; challenge: string; proof: string }> = []
  return {
    received,
    port: async (payload) => {
      received.push(payload)
      return { ok: true } as PushResult
    },
  }
}

describe("fresh PoP at drain time (CAP-8)", () => {
  it("obtains the challenge DURING drain and signs THAT challenge, then pushes the proof", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    await outbox.enqueue("npub_a")

    const challenge = makeChallengeSource()
    const signer = makeSigner()
    const push = okPush()
    const drain = createOutboxDrain({
      outbox,
      getChallenge: challenge.getChallenge,
      signChallenge: signer.signChallenge,
      push: push.port,
    })

    await drain.drain()

    // Challenge fetched at drain time (not enqueue).
    expect(challenge.calls).toHaveLength(1)
    // The fetched challenge is what got signed.
    expect(signer.signed).toEqual(challenge.calls)
    // Push carried {npub, challenge, proof}.
    expect(push.received).toHaveLength(1)
    expect(push.received[0].npub).toBe("npub_a")
    expect(push.received[0].challenge).toBe(challenge.calls[0])
    expect(push.received[0].proof).toBe(`proof(${challenge.calls[0]})`)
    // Slot drained on success.
    expect(await outbox.pending()).toBeNull()
  })

  it("does not fetch or sign a challenge at enqueue time (only at drain)", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    const challenge = makeChallengeSource()
    const signer = makeSigner()
    const push = okPush()
    createOutboxDrain({
      outbox,
      getChallenge: challenge.getChallenge,
      signChallenge: signer.signChallenge,
      push: push.port,
    })
    await outbox.enqueue("npub_a")
    // No drain called yet → nothing fetched/signed/pushed.
    expect(challenge.calls).toHaveLength(0)
    expect(signer.signed).toHaveLength(0)
    expect(push.received).toHaveLength(0)
  })
})

describe("idempotent + supersede-safe (AD-12)", () => {
  it("draining an empty slot is a no-op (no challenge, no push)", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    const challenge = makeChallengeSource()
    const signer = makeSigner()
    const push = okPush()
    const drain = createOutboxDrain({
      outbox,
      getChallenge: challenge.getChallenge,
      signChallenge: signer.signChallenge,
      push: push.port,
    })
    await drain.drain()
    expect(challenge.calls).toHaveLength(0)
    expect(push.received).toHaveLength(0)
  })

  it("markDrained uses the DRAINED seq so a newer enqueue that raced is not cleared", async () => {
    const storage = makeMemStorage()
    const outbox = createPersistentNpubOutbox(storage)
    await outbox.enqueue("npub_a")

    const challenge = makeChallengeSource()
    const signer = makeSigner()
    // A push that supersedes mid-flight: while the push is "in flight", enqueue npub_b.
    const push: PushPort = async (payload) => {
      if (payload.npub === "npub_a") await outbox.enqueue("npub_b")
      return { ok: true }
    }
    const drain = createOutboxDrain({
      outbox,
      getChallenge: challenge.getChallenge,
      signChallenge: signer.signChallenge,
      push,
    })
    await drain.drain()
    // npub_b (enqueued during the drain of npub_a) must survive — not cleared by the stale drain.
    expect((await outbox.pending())?.npub).toBe("npub_b")
  })

  it("a fresh drain instance after restart resumes the still-pending entry", async () => {
    const storage = makeMemStorage()
    const first = createPersistentNpubOutbox(storage)
    await first.enqueue("npub_a")

    // Restart: new outbox + new drain over the same storage.
    const revived = createPersistentNpubOutbox(storage)
    const challenge = makeChallengeSource()
    const signer = makeSigner()
    const push = okPush()
    const drain = createOutboxDrain({
      outbox: revived,
      getChallenge: challenge.getChallenge,
      signChallenge: signer.signChallenge,
      push: push.port,
    })
    await drain.drain()
    expect(push.received[0]?.npub).toBe("npub_a")
    expect(await revived.pending()).toBeNull()
  })
})

describe("backoff schedule (AD-11/AD-12)", () => {
  it("exposes a capped exponential backoff schedule (positive, bounded)", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    const drain = createOutboxDrain({
      outbox,
      getChallenge: async () => "c",
      signChallenge: async () => "p",
      push: async () => ({ ok: true }),
    })
    const delays = drain.backoffSchedule()
    expect(delays.length).toBeGreaterThan(0)
    for (const d of delays) {
      expect(d).toBeGreaterThan(0)
      expect(Number.isFinite(d)).toBe(true)
    }
    // Monotonic non-decreasing then capped (never an unbounded growth, never zero-delay loop).
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
    }
  })
})

describe("stale/absent proof → server reject → no mapping (CAP-8)", () => {
  it("a server rejection leaves the slot pending (re-eligible), writes no mapping", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    await outbox.enqueue("npub_a")
    const rejectingPush: PushPort = async () => ({ ok: false, retryable: false })
    const drain = createOutboxDrain({
      outbox,
      getChallenge: async () => "c",
      signChallenge: async () => "p",
      push: rejectingPush,
    })
    await drain.drain()
    // Not marked drained — still pending for a later (fresh-challenge) attempt.
    expect((await outbox.pending())?.npub).toBe("npub_a")
  })
})

describe("endpoint absent → graceful re-queue, never surfaces/blocks (FR-9)", () => {
  it("a thrown push (endpoint absent) is swallowed; slot stays pending; no throw", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    await outbox.enqueue("npub_a")
    const throwingPush: PushPort = async () => {
      throw new Error("ECONNREFUSED: endpoint does not exist yet")
    }
    const drain = createOutboxDrain({
      outbox,
      getChallenge: async () => "c",
      signChallenge: async () => "p",
      push: throwingPush,
    })
    // Must resolve (swallow) — never reject to the caller.
    await expect(drain.drain()).resolves.toBeUndefined()
    // Re-queued: still pending.
    expect((await outbox.pending())?.npub).toBe("npub_a")
  })

  it("a drain in flight does not block enqueue/pending on the outbox", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    await outbox.enqueue("npub_a")
    let releasePush: () => void = () => undefined
    const gatedPush: PushPort = () =>
      new Promise<PushResult>((resolve) => {
        releasePush = () => resolve({ ok: true })
      })
    const drain = createOutboxDrain({
      outbox,
      getChallenge: async () => "c",
      signChallenge: async () => "p",
      push: gatedPush,
    })
    const inFlight = drain.drain()
    // While the drain awaits the push, the outbox is still usable (non-blocking).
    await outbox.enqueue("npub_b")
    expect((await outbox.pending())?.npub).toBe("npub_b")
    releasePush()
    await inFlight
  })
})
