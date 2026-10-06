// M5: verified Blink Support roster (findings/M5-threshold.md).
// The app pins ONE pubkey — the roster key — and labels a group member "Blink Support ·
// <name>" only if that key signed a current roster listing them. Anything else is
// "UNVERIFIED member". The roster is a NIP-51 kind 30000 follow set:
//   ["d", "blink-support-team"]            addressable: the newest version replaces older ones
//   ["p", <hex>, <relay>, <name>]           one per member (NIP-02 petname position)
//   ["role", <hex>, "bot"]                  members without a role tag are agents
//   ["expiration", <unix seconds>]          NIP-40, REQUIRED: bounds how long a withheld
//                                           revocation can go unnoticed; expired = fail closed
// Verification does not care HOW the roster key signs: one key or a FROST t-of-n group
// key both produce an ordinary BIP-340 signature (M5 R8).
import { verifyEvent } from "nostr-tools/pure"

export const ROSTER_KIND = 30000
export const ROSTER_D = "blink-support-team"
const MAX_CLOCK_SKEW = 600 // seconds a roster may be dated in the future

/** Unsigned roster event template. members: [{ pubkey, name, role?: "agent"|"bot", relay? }] */
export function rosterTemplate({ members, expiresAt, createdAt = Math.floor(Date.now() / 1000), pubkey }) {
  const tags = [["d", ROSTER_D], ["title", "Blink Support team"]]
  for (const m of members) tags.push(["p", m.pubkey, m.relay ?? "", m.name])
  for (const m of members) if (m.role && m.role !== "agent") tags.push(["role", m.pubkey, m.role])
  tags.push(["expiration", String(expiresAt)])
  return { kind: ROSTER_KIND, created_at: createdAt, tags, content: "", ...(pubkey ? { pubkey } : {}) }
}

/**
 * Check one event against the pinned roster pubkey. Pure; no network.
 * @returns {{ ok: true, roster: Roster } | { ok: false, reason: string }}
 * Roster = { id, createdAt, expiresAt, members: Map<hex, { name, role }>, event }
 */
export function parseRoster(event, { rosterPubkey, now = nowSeconds() }) {
  if (!event || event.kind !== ROSTER_KIND) return { ok: false, reason: "not a kind 30000 event" }
  if (event.pubkey !== rosterPubkey) return { ok: false, reason: "not signed by the pinned roster key" }
  if (!event.tags?.some(([t, v]) => t === "d" && v === ROSTER_D)) return { ok: false, reason: `d tag is not "${ROSTER_D}"` }
  // nostr-tools caches verifyEvent's result on the object (a Symbol property that object
  // spread copies too): verify a clean copy, or a tampered in-memory event can pass.
  const { id, pubkey, created_at, kind, tags, content, sig } = event
  if (!verifyEvent({ id, pubkey, created_at, kind, tags, content, sig })) return { ok: false, reason: "bad signature" }
  if (created_at > now + MAX_CLOCK_SKEW) return { ok: false, reason: "dated in the future" }
  const exp = tags.find(([t]) => t === "expiration")?.[1]
  const expiresAt = Number(exp)
  if (!exp || !Number.isSafeInteger(expiresAt)) return { ok: false, reason: "no expiration tag" }
  const roles = new Map(tags.filter(([t]) => t === "role").map(([, pk, role]) => [pk, role]))
  const members = new Map()
  for (const [t, pk, , name] of tags) {
    if (t !== "p" || !/^[0-9a-f]{64}$/.test(pk ?? "")) continue
    members.set(pk, { name: name || pk.slice(0, 8), role: roles.get(pk) ?? "agent" })
  }
  return { ok: true, roster: { id, createdAt: created_at, expiresAt, members, event: { id, pubkey, created_at, kind, tags, content, sig } } }
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

/**
 * Keeps the newest valid roster from the pinned key and labels pubkeys against it.
 * Rollback-safe: an older version (a relay replaying v1 after v2) is never accepted.
 *
 * M11 persistence (patternn review point): with a `persistence` port the newest
 * accepted roster (hence the (created_at, id) anti-rollback floor) and the
 * ever-listed set survive a restart — without it, a restart reset both, so a
 * relay replaying an OLD roster would have been accepted as "first", and
 * "X was removed from the roster" relabeling lost its memory. A `snapshot`
 * (a signed roster event shipped in the binary) seeds the very first run the
 * same way: it goes through `consider()`, so signature/expiry/future-dating and
 * the floor rules apply to it exactly like a relay event. Both are optional;
 * without them the verifier behaves exactly as before (v1 bot and suites).
 *
 * Persistence state shape (version-tagged for forward compat):
 *   { version: 1, roster: <last accepted signed event>|null,
 *     everListed: [[hex, name], ...] }
 * The persisted roster is RESTORED at `restore()` (also run automatically once
 * inside `refresh()`), re-verified by `parseRoster`, and still subject to expiry
 * in `status()` — restoring public signed data, never trusting it blindly.
 */
export class RosterVerifier {
  /**
   * @param {object} o
   * @param {string} o.rosterPubkey the pinned roster key (hex)
   * @param {{ request, subscription }} [o.network] a NostrNetworkInterface (SimplePoolNetwork)
   * @param {string[]} [o.relays]
   * @param {() => number} [o.now] unix seconds
   * @param {(roster, previous) => void} [o.onChange]
   * @param {{ load: () => Promise<object|null>, save: (object) => void|Promise<void> }} [o.persistence]
   * @param {object} [o.snapshot] a signed roster event shipped in the app, seeding first run
   */
  constructor({ rosterPubkey, network, relays = [], now = nowSeconds, onChange, persistence, snapshot }) {
    this.rosterPubkey = rosterPubkey
    this.network = network
    this.relays = relays
    this.now = now
    this.onChange = onChange
    this.persistence = persistence ?? null
    this.snapshot = snapshot ?? null
    this.current = null
    this.everListed = new Map() // hex -> name, from every roster ever accepted
    this.saving = Promise.resolve() // in-flight persistence write (tests may await)
    this.#restored = false
  }

  #restored

  /** Restore persisted state and consider the shipped snapshot. Idempotent; also run by refresh(). */
  async restore() {
    if (this.#restored) return this.status()
    this.#restored = true
    if (this.persistence) {
      const saved = await this.persistence.load().catch(() => null)
      if (saved?.everListed)
        for (const [pk, name] of saved.everListed) this.everListed.set(pk, name)
      // consider() re-verifies the signature and applies the floor rules; a persisted
      // roster older than the snapshot is refused, and vice versa, by created_at.
      if (saved?.roster) this.consider(saved.roster)
    }
    if (this.snapshot) this.consider(this.snapshot)
    return this.status()
  }

  #persist() {
    if (!this.persistence) return
    const state = {
      version: 1,
      roster: this.current?.event ?? null,
      everListed: [...this.everListed.entries()],
    }
    // Fire-and-forget: a failed save never breaks roster handling; tests await `saving`.
    this.saving = Promise.resolve(this.persistence.save(state)).catch(() => {})
  }

  get filter() {
    return { kinds: [ROSTER_KIND], authors: [this.rosterPubkey], "#d": [ROSTER_D] }
  }

  /** Offer an event (from a relay, a cache or a test). Returns { accepted, reason }. */
  consider(event) {
    const res = parseRoster(event, { rosterPubkey: this.rosterPubkey, now: this.now() })
    if (!res.ok) return { accepted: false, reason: res.reason }
    const next = res.roster
    const cur = this.current
    if (cur) {
      if (next.id === cur.id) return { accepted: false, reason: "already current" }
      // NIP-01 addressable events: newest created_at wins; on a tie, the lowest id.
      const newer = next.createdAt > cur.createdAt || (next.createdAt === cur.createdAt && next.id < cur.id)
      if (!newer) return { accepted: false, reason: "older than the current roster (rollback refused)" }
    }
    this.current = next
    for (const [pk, m] of next.members) this.everListed.set(pk, m.name)
    this.#persist()
    this.onChange?.(next, cur)
    return { accepted: true, reason: cur ? "replaced" : "first" }
  }

  /** One-shot fetch from the relays. Restores persisted state + snapshot first (once). */
  async refresh() {
    await this.restore()
    const events = await this.network.request(this.relays, [this.filter])
    for (const e of events.sort((a, b) => a.created_at - b.created_at)) this.consider(e)
    return this.status()
  }

  /** Live updates; returns { unsubscribe }. */
  subscribe() {
    return this.network.subscription(this.relays, [this.filter]).subscribe({ next: (e) => this.consider(e) })
  }

  /** "none" | "valid" | "expired" */
  status() {
    if (!this.current) return "none"
    return this.now() >= this.current.expiresAt ? "expired" : "valid"
  }

  /** @returns {{ verified: boolean, name?: string, role?: string, reason: string }} */
  label(pubkey) {
    const status = this.status()
    if (status === "none") return { verified: false, reason: "no Blink Support roster available" }
    if (status === "expired")
      return { verified: false, reason: `Blink Support roster is stale (expired ${new Date(this.current.expiresAt * 1000).toISOString()})` }
    const m = this.current.members.get(pubkey)
    if (m) return { verified: true, name: m.name, role: m.role, reason: "on the Blink Support roster" }
    if (this.everListed.has(pubkey))
      return { verified: false, reason: `${this.everListed.get(pubkey)} was removed from the Blink Support roster` }
    return { verified: false, reason: "not on the Blink Support roster" }
  }

  /** What the app shows for a group member. */
  display(pubkey) {
    const l = this.label(pubkey)
    if (!l.verified) return `UNVERIFIED member ${pubkey.slice(0, 8)} (${l.reason})`
    return l.role === "bot" ? "Blink Support · assistant (automated)" : `Blink Support · ${l.name}`
  }
}
