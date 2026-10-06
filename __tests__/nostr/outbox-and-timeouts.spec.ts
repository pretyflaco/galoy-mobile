/**
 * Story 1.5 — outbox single-slot (AC-7/AD-12) + bounded-wait timeout constants
 * (AC-4/AC-7/AD-11) + ceremony budget (AC-2).
 */
import { createNpubOutbox } from "../../app/nostr/core/outbox"
import {
  STAGE_TIMEOUT_MS,
  OUTER_CONNECT_TIMEOUT_MS,
  SLOW_CONNECTION_HINT_MS,
  CEREMONY_BUDGET_MS,
} from "../../app/nostr/config"

describe("single-slot npub outbox (AD-12)", () => {
  it("holds the latest npub; a newer enqueue supersedes the pending one", () => {
    const outbox = createNpubOutbox()
    expect(outbox.pending()).toBeNull()
    outbox.enqueue("npub_a")
    outbox.enqueue("npub_b") // supersedes
    expect(outbox.pending()).toBe("npub_b")
  })

  it("markDrained clears only if the drained value is still pending", () => {
    const outbox = createNpubOutbox()
    outbox.enqueue("npub_a")
    outbox.enqueue("npub_b")
    outbox.markDrained("npub_a") // stale drain — must NOT clear npub_b
    expect(outbox.pending()).toBe("npub_b")
    outbox.markDrained("npub_b")
    expect(outbox.pending()).toBeNull()
  })
})

describe("bounded-wait timeout constants (AD-11) + budget (NFR-2)", () => {
  it("slow-connection hint precedes the stage timeout, which precedes the outer bound", () => {
    expect(SLOW_CONNECTION_HINT_MS).toBeLessThan(STAGE_TIMEOUT_MS)
    expect(STAGE_TIMEOUT_MS).toBeLessThanOrEqual(OUTER_CONNECT_TIMEOUT_MS)
  })

  it("timeouts are finite positive numbers (no infinite spinner is representable)", () => {
    for (const t of [
      SLOW_CONNECTION_HINT_MS,
      STAGE_TIMEOUT_MS,
      OUTER_CONNECT_TIMEOUT_MS,
    ]) {
      expect(Number.isFinite(t)).toBe(true)
      expect(t).toBeGreaterThan(0)
    }
  })

  it("ceremony budget is 30s (SPEC CAP-1)", () => {
    expect(CEREMONY_BUDGET_MS).toBe(30_000)
  })
})
