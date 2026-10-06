// POC NostrNetworkInterface (02-poc-plan.md Addendum A2) over nostr-tools SimplePool.
// NIP-42 AUTH is answered automatically as the signer's pubkey on every relay
// (SimplePool `automaticallyAuth`) — required because wok withholds gift wraps
// (kind 1059, Marmot invites) from unauthenticated readers (findings/M0-setup.md
// F-M0-1). The signer must therefore be able to sign kind-22242 events; the POC
// TestEventSigner signs anything.
// The Blink form (M6) uses the fork's relay pool (also SimplePool-based).
import { SimplePool } from "nostr-tools/pool"

export class SimplePoolNetwork {
  /**
   * @param {object} options
   * @param {import("applesauce-core").EventSigner} options.signer signs AUTH (kind 22242) events
   * @param {string[]} [options.relays] default relays for getUserInboxRelays lookups
   */
  constructor({ signer, relays = [] }) {
    this.signer = signer
    this.relays = relays
    // F-M12-2 stall detection: last time a kind-445 (group traffic) event was
    // delivered on ANY subscription, and an optional hook fired when a
    // subscription closes (a silently dead sub = missed messages).
    this.activity445At = 0
    this.onSubClosed = null
    this.destroyed = false
    // M20 (Hermes M1): AUTH only for the relays this client was configured with
    const allowedAuthRelays = new Set(relays.map((r) => r.replace(/\/+$/, "")))
    this.pool = new SimplePool({
      automaticallyAuth: () => (event) => {
        const tag = event.tags?.find((t) => t[0] === "relay")?.[1]?.replace(/\/+$/, "")
        if (tag && allowedAuthRelays.has(tag)) return Promise.resolve(this.signer.signEvent(event))
        return Promise.reject(new Error(`refusing NIP-42 AUTH for unconfigured relay ${tag ?? "?"}`))
      },
    })
  }

  /** Publish an event; resolves with a per-relay result record. */
  async publish(relays, event) {
    const settled = await Promise.allSettled(this.pool.publish(relays, event))
    return Object.fromEntries(
      relays.map((relay, i) => {
        const r = settled[i]
        return [
          relay,
          r.status === "fulfilled"
            ? { from: relay, ok: true }
            : { from: relay, ok: false, message: String(r.reason?.message ?? r.reason) },
        ]
      }),
    )
  }

  /** One-shot request: collects events until EOSE (with AUTH) per filter, deduped by id. */
  async request(relays, filters) {
    const list = Array.isArray(filters) ? filters : [filters]
    const found = new Map()
    await Promise.all(
      list.map(
        (filter) =>
          new Promise((resolve) => {
            this.pool.subscribeEose(relays, filter, {
              onevent: (event) => found.set(event.id, event),
              onauth: (event) => Promise.resolve(this.signer.signEvent(event)),
              maxWait: 5000,
              onclose: resolve,
            })
          }),
      ),
    )
    return [...found.values()]
  }

  /** Live subscription of single events. Returns a Subscribable per NostrNetworkInterface. */
  subscription(relays, filters) {
    const list = Array.isArray(filters) ? filters : [filters]
    const pool = this.pool
    // `this` inside the returned object's subscribe() is that object, not the network
    // (F-M18-7: the F-M12-2 hooks below were set on it and never fired) — use `net`.
    const net = this
    const signEvent = (event) => Promise.resolve(net.signer.signEvent(event))
    return {
      subscribe(observer) {
        const seen = new Set()
        let closedByUs = false
        const subs = list.map((filter) =>
          pool.subscribeMany(relays, filter, {
            onevent: (event) => {
              if (seen.has(event.id)) return
              seen.add(event.id)
              // F-M12-2: transport activity signal for the stall detector
              if (filter.kinds?.includes(445)) net.activity445At = Date.now()
              observer.next?.(event)
            },
            onauth: signEvent,
            onclose: (reasons) => {
              // nostr-tools passes [{ url, reason }] (one per relay)
              const reason = Array.isArray(reasons)
                ? reasons.map((r) => (r && typeof r === "object" ? `${r.url}: ${r.reason}` : String(r))).join("; ")
                : String(reasons ?? "?")
              console.log(`[support-chat-net] sub closed${closedByUs || net.destroyed ? " (by us)" : ""}: ${reason}`)
              // only an unexpected close (relay or connection) is a dead subscription
              if (!closedByUs && !net.destroyed) net.onSubClosed?.(reason)
            },
          }),
        )
        return {
          unsubscribe: () => {
            closedByUs = true
            subs.forEach((s) => s.close())
          },
        }
      },
    }
  }

  /** Inbox relays from the user's kind-10051 (key-package relays) or kind-10050 event. */
  async getUserInboxRelays(pubkey) {
    const events = await this.request(this.relays, [
      { kinds: [10051, 10050], authors: [pubkey], limit: 5 },
    ])
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0]
    if (!latest) return []
    return latest.tags.filter(([t]) => t === "r" || t === "relay").map(([, url]) => url)
  }

  async destroy() {
    this.destroyed = true // its subscriptions' closes are ours, never "dead"
    await this.pool.destroy()
  }
}
