/**
 * Single-slot npub outbox (AD-12 / AD-17). On identity create/import the new npub is
 * queued for push to the Blink backend; a later drain (Story 2.2) delivers it carrying a
 * fresh proof-of-possession. Story 2.3 wires create/import to enqueue here + fire a drain.
 *
 * Single-slot latest-state cell `{npub, seq}` with a MONOTONIC sequence: only the latest
 * npub matters (a newer identity supersedes an older queued one), so the slot holds at most
 * one pending value. The monotonic seq is what makes a superseded (discarded-key) npub
 * unable to win a race — `markDrained(seq)` clears the slot ONLY when the drained seq is
 * still the current pending seq, so a slow drain of an old npub can never clear a freshly
 * enqueued newer one.
 *
 * Persisted as JSON via the app's existing `app/utils/storage` under the versioned key
 * `nostr.outbox.v1` (AD-17) so a pending entry survives restart and remains eligible for
 * drain. The storage port is injected (unit-testable in-memory); the default binds to the
 * util. AD-1: core is UI-free.
 *
 * Non-blocking is the load-bearing invariant (FR-9): a pending or failing push must be
 * invisible to the ceremony, import, and all signing — the identity is usable regardless.
 * `enqueue` therefore swallows a persistence failure (the in-memory slot stays
 * authoritative) and never rejects to the caller.
 */
import { loadJson, saveJson } from "@app/utils/storage"

/** AD-17 storage key. */
export const OUTBOX_STORAGE_KEY = "nostr.outbox.v1"

/** The single-slot latest-state cell (AD-12). */
export interface OutboxEntry {
  npub: string
  /** Monotonic sequence — a superseded npub carries a lower seq and can never win. */
  seq: number
}

/** The narrow persistence port (injected; defaults to app/utils/storage). */
export interface OutboxStorage {
  loadJson: (key: string) => Promise<unknown>
  saveJson: (key: string, value: unknown) => Promise<void>
}

export interface PersistentNpubOutbox {
  /** Queue the latest npub for push; bumps the monotonic seq and overwrites the slot. */
  enqueue(npub: string): Promise<void>
  /** The currently-pending entry, or null if the slot is empty/drained. */
  pending(): Promise<OutboxEntry | null>
  /** Mark the slot drained; clears ONLY if `seq` is still the current pending seq. */
  markDrained(seq: number): Promise<void>
}

const defaultStorage: OutboxStorage = { loadJson, saveJson }

const isEntry = (raw: unknown): raw is OutboxEntry => {
  if (typeof raw !== "object" || raw === null) return false
  const maybe = raw as { npub?: unknown; seq?: unknown }
  return typeof maybe.npub === "string" && typeof maybe.seq === "number"
}

export const createPersistentNpubOutbox = (
  storage: OutboxStorage = defaultStorage,
): PersistentNpubOutbox => {
  // In-memory slot cache. Loaded lazily from storage on first access so a fresh instance
  // over existing storage (a restart) sees the prior slot. Once loaded it stays
  // authoritative — a persistence failure never loses the enqueued npub (non-blocking).
  let slot: OutboxEntry | null = null
  // The highest seq ever issued by THIS instance; seeded from the persisted slot so
  // monotonicity survives restart (seq never resets to 0 on relaunch).
  let lastSeq = 0

  // Memoize the initial load as a single promise so concurrent callers await the SAME
  // read (no check-await-set race on a `loaded` flag; require-atomic-updates safe).
  let loadOnce: Promise<void> | null = null
  const ensureLoaded = (): Promise<void> => {
    if (!loadOnce) {
      loadOnce = storage.loadJson(OUTBOX_STORAGE_KEY).then((raw) => {
        if (isEntry(raw)) {
          slot = raw
          lastSeq = raw.seq
        }
      })
    }
    return loadOnce
  }

  return {
    async enqueue(npub: string): Promise<void> {
      await ensureLoaded()
      lastSeq += 1
      slot = { npub, seq: lastSeq }
      try {
        await storage.saveJson(OUTBOX_STORAGE_KEY, slot)
      } catch {
        // Swallowed by design (FR-9): a failed persist must NOT block the identity. The
        // in-memory slot stays authoritative; the drain will still find it this session.
      }
    },

    async pending(): Promise<OutboxEntry | null> {
      await ensureLoaded()
      return slot
    },

    async markDrained(seq: number): Promise<void> {
      await ensureLoaded()
      // Only clear if the drained seq is still the pending one — a stale drain (older seq)
      // must never clobber a newer enqueue that raced ahead of it.
      if (slot && slot.seq === seq) {
        slot = null
        try {
          await storage.saveJson(OUTBOX_STORAGE_KEY, null)
        } catch {
          // Swallowed: a failed clear leaves the drained value re-eligible; the drain is
          // idempotent (Story 2.2), so a redundant re-push is harmless.
        }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Legacy in-memory single-slot outbox (Story 1.5 placeholder).
//
// Retained so the Story 1.5 ceremony/import hooks keep compiling until Story 2.3 wires them
// to the persistent outbox above. Holds the latest npub only (string slot). Do NOT use for
// new code — the persistent `{npub, seq}` cell is the AD-12/AD-17 outbox.
// ---------------------------------------------------------------------------
export interface NpubOutbox {
  /** Queue the latest npub for push. Overwrites any pending slot (single-slot). */
  enqueue(npub: string): void
  /** The currently-pending npub, or null if the slot is empty/drained. */
  pending(): string | null
  /** Mark the slot drained (called by the drain on successful delivery). */
  markDrained(npub: string): void
}

export const createNpubOutbox = (): NpubOutbox => {
  let slot: string | null = null
  return {
    enqueue(npub: string) {
      slot = npub
    },
    pending() {
      return slot
    },
    markDrained(npub: string) {
      if (slot === npub) slot = null
    },
  }
}
