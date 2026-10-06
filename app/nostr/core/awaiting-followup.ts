/**
 * Awaiting-follow-up store (sign-in waiting state).
 *
 * After a CONNECTION is approved, the client (BTCPay/vezir) sends its login request (a
 * sign_event, e.g. NIP-98 kind 27235) over the relay a moment later. Between the connection
 * approval resolving and that request arriving there is a network round-trip with no UI — the
 * approval overlay would just vanish. This store models that gap so the UI can hold a
 * "Waiting for sign-in challenge from app…" surface (client avatar + name + spinner).
 *
 * Set on connection-approve; cleared when the follow-up sign_event is approved AND its signed
 * response is confirmed-published to a relay (the strongest "sign-in delivered" signal that
 * physically exists — the client completes login over HTTP with no callback to the signer), or
 * on a bounded timeout so a client that never sends the request cannot hang the spinner.
 *
 * AD-1: UI-free state; the overlay screen is pure presentation. Same subscribe/notify shape as
 * the duplicate-prompt store.
 */

/** The client we are waiting on (display fields only). */
export interface AwaitingFollowup {
  clientPubkey: string
  name?: string
  image?: string
}

export interface AwaitingFollowupStore {
  /** Begin waiting on a client's login follow-up. */
  set(state: AwaitingFollowup): void
  /** Stop waiting on `clientPubkey` (no-op if a DIFFERENT client is currently awaited). */
  clear(clientPubkey: string): void
  /** The client currently awaited, or null. */
  current(): AwaitingFollowup | null
  /** Subscribe to changes; returns an unsubscribe. */
  subscribe(listener: () => void): () => void
}

export const createAwaitingFollowupStore = (): AwaitingFollowupStore => {
  let active: AwaitingFollowup | null = null
  const listeners = new Set<() => void>()
  const notify = (): void => listeners.forEach((l) => l())

  return {
    set(state): void {
      active = state
      notify()
    },
    clear(clientPubkey): void {
      // Only clear if we are still waiting on THIS client — a stale timeout must not wipe a newer
      // wait for a different connection.
      if (active?.clientPubkey !== clientPubkey) return
      active = null
      notify()
    },
    current: () => active,
    subscribe(listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
