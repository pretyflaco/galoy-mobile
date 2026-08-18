/**
 * Awaiting-follow-up store — the sign-in "waiting for login request" state that bridges the gap
 * between a connection approval and the client's login sign_event arriving over the relay.
 * Verifies set/current/clear, per-client clear guard (a stale timeout must not wipe a newer
 * wait), and subscriber notifications.
 */
import { createAwaitingFollowupStore } from "@app/nostr/core/awaiting-followup"

describe("awaiting-followup store", () => {
  it("set makes current() return the client; clear(sameClient) resets it", () => {
    const store = createAwaitingFollowupStore()
    expect(store.current()).toBeNull()
    store.set({ clientPubkey: "a", name: "BTCPay Server" })
    expect(store.current()).toMatchObject({ clientPubkey: "a", name: "BTCPay Server" })
    store.clear("a")
    expect(store.current()).toBeNull()
  })

  it("clear(otherClient) is a no-op (a stale timeout cannot wipe a newer wait)", () => {
    const store = createAwaitingFollowupStore()
    store.set({ clientPubkey: "new" })
    store.clear("old") // stale timeout for a previous connection
    expect(store.current()).toMatchObject({ clientPubkey: "new" })
  })

  it("notifies subscribers on set and on clear", () => {
    const store = createAwaitingFollowupStore()
    const listener = jest.fn()
    const unsub = store.subscribe(listener)
    store.set({ clientPubkey: "a" })
    expect(listener).toHaveBeenCalledTimes(1)
    store.clear("a")
    expect(listener).toHaveBeenCalledTimes(2)
    unsub()
    store.set({ clientPubkey: "b" })
    expect(listener).toHaveBeenCalledTimes(2) // unsubscribed → no more calls
  })
})
