/**
 * npub push-and-drain adapter (Story 2.3 / AD-12 / FR-9).
 *
 * The SINGLE create/import push seam: on identity create or import, `push(npub)` enqueues the
 * npub into the persistent single-slot outbox (Story 2.1 — bumps the monotonic seq, supersedes
 * any prior slot) and fires the idempotent drain (Story 2.2).
 *
 * Non-blocking (the load-bearing invariant): `push` awaits ONLY the durable enqueue — the
 * outbox's in-memory slot is authoritative even if persistence fails (Story 2.1) — then fires
 * the drain FIRE-AND-FORGET (never awaited, errors swallowed). A slow, failing, or not-yet-built
 * endpoint can therefore never block or delay the ceremony/import completion.
 *
 * AD-1: core is UI-free.
 */
import type { PersistentNpubOutbox } from "./outbox"

/** The minimal drain surface this adapter fires (Story 2.2's OutboxDrain). */
export interface DrainTrigger {
  drain(): Promise<void>
}

export interface NpubPushPorts {
  outbox: PersistentNpubOutbox
  drain: DrainTrigger
}

export interface NpubPush {
  /** Enqueue the npub (durable) then fire a non-blocking drain. Never blocks on the drain. */
  push(npub: string): Promise<void>
}

export const createNpubPush = (ports: NpubPushPorts): NpubPush => {
  const { outbox, drain } = ports
  return {
    async push(npub: string): Promise<void> {
      // Await only the enqueue so the new npub is durably the pending slot before we return.
      await outbox.enqueue(npub)
      // Fire-and-forget the drain: do NOT await it, and swallow any rejection, so a slow or
      // failing (or absent) endpoint can never block or delay create/import completion.
      drain.drain().catch(() => undefined)
    },
  }
}
