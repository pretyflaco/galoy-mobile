/**
 * Single-slot npub outbox (AD-12). On identity create/import the new npub is queued for
 * push to the Blink backend; a later drain (Story 2.x) delivers it. Story 1.5 needs only
 * the non-blocking enqueue: the ceremony pushes the npub here and NEVER blocks on it.
 *
 * Single-slot: only the latest npub matters (a newer identity supersedes an older queued
 * one), so the slot holds at most one pending value. AD-1: core is UI-free.
 */
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
      // Only clear if the drained value is still the pending one (avoid clobbering a
      // newer enqueue that raced the drain).
      if (slot === npub) slot = null
    },
  }
}
