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
    this.pool = new SimplePool({
      automaticallyAuth: () => (event) => Promise.resolve(this.signer.signEvent(event)),
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
    const t0 = Date.now()
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
    const events = [...found.values()]
    // TEMP M12 debug (F-M12-2): fetch visibility — is the backfill getting events?
    console.log(
      `[support-chat-net] request kinds=[${list.map((f) => f.kinds).join("|")}] h=${list[0]["#h"]?.[0]?.slice(0, 8) ?? "-"} → ${events.length} events in ${Date.now() - t0}ms`,
    )
    return events
  }

  /** Live subscription of single events. Returns a Subscribable per NostrNetworkInterface. */
  subscription(relays, filters) {
    const list = Array.isArray(filters) ? filters : [filters]
    const pool = this.pool
    const signEvent = (event) => Promise.resolve(this.signer.signEvent(event))
    return {
      subscribe(observer) {
        const seen = new Set()
        const subs = list.map((filter) =>
          pool.subscribeMany(relays, filter, {
            onevent: (event) => {
              if (seen.has(event.id)) return
              seen.add(event.id)
              // TEMP M12 debug (F-M12-2): live-delivery visibility
              if (seen.size === 1 || seen.size % 10 === 0)
                console.log(`[support-chat-net] sub live event #${seen.size} (kinds=[${filter.kinds}])`)
              observer.next?.(event)
            },
            onauth: signEvent,
            onclose: (reason) => console.log(`[support-chat-net] sub closed: ${reason ?? "?"}`),
          }),
        )
        console.log(`[support-chat-net] sub opened (kinds=[${list.map((f) => f.kinds).join("|")}])`)
        return { unsubscribe: () => subs.forEach((s) => s.close()) }
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
    await this.pool.destroy()
  }
}
