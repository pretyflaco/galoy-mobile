/**
 * Story 2.3 — the create/import push-and-drain adapter (AD-12 / FR-9).
 *
 * `createNpubPush({ outbox, drain }).push(npub)` enqueues the npub into the persistent
 * single-slot outbox (bumped seq) and fires a drain — non-blocking: a drain that hangs or
 * rejects never delays or fails `push`. A re-import supersedes the prior mapping.
 */
import { createNpubPush } from "../../app/nostr/core/npub-push"
import {
  createPersistentNpubOutbox,
  type OutboxStorage,
} from "../../app/nostr/core/outbox"

const makeMemStorage = (): OutboxStorage => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (key) => (map.has(key) ? map.get(key) : null),
    saveJson: async (key, value) => {
      map.set(key, JSON.parse(JSON.stringify(value)))
    },
  }
}

describe("createNpubPush adapter (Story 2.3)", () => {
  it("enqueues the npub into the outbox AND attempts a drain", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    let drainCalls = 0
    const drain = {
      drain: async () => {
        drainCalls += 1
      },
      backoffSchedule: () => [1],
    }
    const push = createNpubPush({ outbox, drain })

    await push.push("npub_a")

    expect((await outbox.pending())?.npub).toBe("npub_a")
    expect(drainCalls).toBe(1)
  })

  it("is non-blocking: a hanging drain does not delay push resolution", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    const drain = {
      // Never resolves — must not block push.
      drain: () =>
        new Promise<void>(() => {
          /* intentionally never settles */
        }),
      backoffSchedule: () => [1],
    }
    const push = createNpubPush({ outbox, drain })
    await expect(push.push("npub_a")).resolves.toBeUndefined()
    // The enqueue is durable even though the drain is still hanging.
    expect((await outbox.pending())?.npub).toBe("npub_a")
  })

  it("swallows a drain rejection (never surfaces to the caller)", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    const drain = {
      drain: async () => {
        throw new Error("drain blew up")
      },
      backoffSchedule: () => [1],
    }
    const push = createNpubPush({ outbox, drain })
    await expect(push.push("npub_a")).resolves.toBeUndefined()
  })

  it("a re-push (re-import) supersedes the prior mapping monotonically", async () => {
    const outbox = createPersistentNpubOutbox(makeMemStorage())
    const drain = { drain: async () => undefined, backoffSchedule: () => [1] }
    const push = createNpubPush({ outbox, drain })

    await push.push("npub_a")
    const first = await outbox.pending()
    await push.push("npub_b") // re-import supersedes
    const second = await outbox.pending()

    expect(second?.npub).toBe("npub_b")
    expect(second?.seq).toBeGreaterThan(first?.seq as number)
  })
})
