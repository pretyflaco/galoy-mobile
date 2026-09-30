/**
 * In-app E2EE support chat over Marmot v2 (P1, feat/support-chat). Product wiring of
 * the v2 core proven headless in blink-support-chat interop/v2 (M11):
 *  - marmot-ts master 0.6.0 via `connect()`/`connectAll()` — the LIBRARY's inbound
 *    loop (backfill + live + dedupe + ingest + durable pending pool, F-M9-5); the
 *    v1 GroupIngestor is retired (M9 retirement table). Sender binding is enforced
 *    upstream at this layer (F-M9-3), so the `applicationMessage` event is now a
 *    safe consumption point (it was NOT on 0.5.1).
 *  - discovery: keyPackages.ensurePublished (30443, rotates; F-M9-1 patch applies at
 *    install) + manual 10051/10050/10002 relay lists (F-M9-7/F-M9-12) — the app must
 *    be invitable so support can re-invite it (req 8's re-invite path).
 *  - the support identity is DISCOVERED from the verified roster (pinned key,
 *    role=bot) and named group admin at creation (F-M4-6a); fail closed without a
 *    valid roster; roster state (anti-rollback floor + ever-listed) persists
 *    encrypted and a shipped snapshot seeds first run (M11).
 *  - storage: everything encrypted at rest (AES-256-GCM, keychain-held per-account
 *    key — F-M6-7), incl. the durable ingest pool and removal markers.
 *  - upgrade policy as code (req 8 / gate 2): groups load one by one
 *    (fault-tolerant loadGroups, F-M9-7), an unreadable group becomes "could not be
 *    restored" read-only history + the start button again (support re-invite path);
 *    app start NEVER fails on stored state.
 *
 * P1 scope: core only. Roster labels are minimal (roster.display), membership
 * notices are not built (P2), the entry screen is scaffolding (P2 redesign).
 */
import {
  MarmotClient,
  createChatRumor,
  createApplicationMessageIntent,
  deserializeApplicationData,
  getGroupMembers,
} from "@internet-privacy/marmot-ts"
import { hermesCryptoProvider } from "@blink-support-chat/adapters/hermes-crypto-provider.js"
import { SimplePoolNetwork } from "@blink-support-chat/adapters/network.js"
import { RosterVerifier } from "@blink-support-chat/adapters/roster.js"
import { loadGroups } from "@blink-support-chat/adapters/load-groups.js"
import {
  ensureDiscoverable,
  fetchKeyPackageEvent,
} from "@blink-support-chat/adapters/key-package-publish.js"

import type { SignerRuntime } from "@app/nostr/runtime"
import { ensureUrlCanParse } from "@app/polyfills/url-can-parse"

// TEMP M12 debug (F-M12-2): surface the library's internal logger — the connect
// drain swallows ingest exceptions into it ("connect: ingest failed …").
import debug from "debug"
debug.enable("marmot-ts:*")

import { SUPPORT_ROSTER_PUBKEY, ROSTER_SNAPSHOT } from "./roster-config"
import { createBlinkEventSigner } from "./blink-signer"
import { EncryptedKeyValueStore } from "./encrypted-store"

import Config from "react-native-config"

/** Chat relays (req 15: the dedicated NIP-42 pool). Staging by default; CI smoke
 *  overrides via ENVFILE (SUPPORT_CHAT_RELAY=ws://10.0.2.2:7777 against a local wok). */
const configuredRelay =
  typeof Config?.SUPPORT_CHAT_RELAY === "string" &&
  Config.SUPPORT_CHAT_RELAY.startsWith("ws")
    ? Config.SUPPORT_CHAT_RELAY
    : undefined
export const SUPPORT_CHAT_RELAYS = [configuredRelay ?? "wss://relay.twentyone.ist"]
const MAX_ITEMS = 500

export type ChatItem = {
  id: string
  at: number
  type: "msg" | "notice" | "warning"
  from?: string // authenticated sender (hex) for msg items — MLS-bound on v2 (F-M9-3)
  mine?: boolean
  text: string
}

export type MemberLabel = {
  pubkey: string
  text: string
  verified: boolean
  role?: string
}

/**
 * Option C (F-M16-1): conversations are sessions/tickets, not one endless chat. A
 * conversation that cannot continue (stuck on this device, removed, unrestorable after
 * an update) is ENDED — a first-class state with its history readable — and "start a
 * new conversation" is always the way forward. The new one names the old one
 * (["supersedes", gid] on its first rumor) so support closes the old thread and a human
 * handoff carries over.
 */
export type EndReason = "user" | "stuck" | "removed" | "unrestorable" | "replaced"
export type Conversation = {
  gid: string
  startedAt: number
  status: "active" | "ended"
  endedAt?: number
  reason?: EndReason
}
type Meta = { activeGroup?: string; conversations?: Record<string, Conversation> }

/** F-M16-1 guard anomalies (scripts/patch-marmot-ts-v2.mjs → globalThis hook). */
type IngestAnomaly = {
  kind: string
  groupId?: string
  epoch?: number
  envelope?: string
  attempt?: number
  awaited?: string
  promise?: string
  recovered?: string
  value?: string
}
const anomalyListeners = new Set<(a: IngestAnomaly) => void>()
;(
  globalThis as { __marmotIngestAnomaly?: (a: IngestAnomaly) => void }
).__marmotIngestAnomaly = (a) => anomalyListeners.forEach((fn) => fn(a))
/** A conversation whose commit keeps failing for this long without the epoch moving is ended. */
const STUCK_GRACE_MS = 60_000
/** Persisted roster state shape (M11 roster.js persistence port). */
type RosterPersisted = {
  version: number
  roster: unknown
  everListed: [string, string][]
} | null

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyGroup = any

const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
const now = () => Math.floor(Date.now() / 1000)
const short = (s: string) => s.slice(0, 8)

export class SupportChatClient {
  status = "starting"
  items: ChatItem[] = []
  pubkey = ""
  groupId: string | null = null

  private listeners = new Set<() => void>()
  private network: any
  private client: any
  private roster: any
  private rosterSub: { unsubscribe: () => void } | null = null
  private conn: { unsubscribe: () => void } | null = null
  private inviteListen: { unsubscribe: () => void } | null = null
  private inviteWatch: AbortController | null = null
  private group: AnyGroup = null
  private meta: Meta = {}
  private metaStore: EncryptedKeyValueStore<Meta>
  private history: EncryptedKeyValueStore<ChatItem[]>
  private attached = new Set<AnyGroup>()
  private destroyed = false
  private knownMembers = new Map<string, Set<string>>() // per conversation: membership notices (req 5)
  // F-M12-2 stall detection: the engine can go silently dead (nondeterministic
  // processMessage failure on Hermes) while transport keeps delivering. The proven
  // recovery is a client re-init (fresh engine state re-ingests everything).
  private engineActivityAt = Date.now()
  private stallWatch: ReturnType<typeof setInterval> | null = null
  private reInits = 0
  private reIniting = false
  // Option C: a past conversation opened read-only (null = the current one)
  viewing: string | null = null
  viewItems: ChatItem[] = []
  private stuckTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onAnomaly = (a: IngestAnomaly) => this.handleAnomaly(a)

  constructor(
    private readonly runtime: SignerRuntime,
    private readonly accountKey: string,
  ) {
    this.metaStore = new EncryptedKeyValueStore<Meta>(accountKey, "meta:")
    this.history = new EncryptedKeyValueStore<ChatItem[]>(accountKey, "history:")
    anomalyListeners.add(this.onAnomaly)
  }

  // --- Option C: conversations as sessions ------------------------------------------

  /** All conversations on this device, newest first. */
  conversations(): Conversation[] {
    return Object.values(this.meta.conversations ?? {}).sort(
      (a, b) => b.startedAt - a.startedAt,
    )
  }

  /** The current conversation's record (the one the composer belongs to). */
  current(): Conversation | null {
    return this.groupId ? this.meta.conversations?.[this.groupId] ?? null : null
  }

  isEnded(): boolean {
    return this.current()?.status === "ended"
  }

  private async saveMeta() {
    await this.metaStore.setItem("meta", this.meta)
  }

  private async endConversation(gid: string, reason: EndReason) {
    const c = (this.meta.conversations ??= {})[gid]
    if (!c || c.status === "ended") return
    c.status = "ended"
    c.reason = reason
    c.endedAt = now()
    this.log(`conversation ${short(gid)} ended (${reason})`)
    await this.saveMeta()
    this.emit()
  }

  /**
   * F-M16-1 stuck detection: the guard gave up on an envelope of OUR group. The engine
   * still retries it (bounded passes); if the epoch has not moved after a grace period,
   * the conversation cannot continue on this device → ended, with a way forward.
   */
  private handleAnomaly(a: IngestAnomaly) {
    this.log(`ingest anomaly ${JSON.stringify(a)}`) // Option B evidence (no secrets: ids, types)
    if (
      a.kind !== "processMessage-gave-up" ||
      !this.group ||
      this.stuckTimer ||
      this.isEnded()
    )
      return
    const group = this.group
    if (hex(group.state.groupContext.groupId) !== a.groupId) return
    const gid = this.groupId as string
    const epoch = group.state.groupContext.epoch
    this.stuckTimer = setTimeout(() => {
      this.stuckTimer = null
      if (this.destroyed || this.groupId !== gid) return
      if (group.state.groupContext.epoch !== epoch)
        return this.log(`stuck suspicion cleared (epoch moved)`)
      void this.endConversation(gid, "stuck")
    }, STUCK_GRACE_MS)
  }

  /** Open a past conversation read-only (null = back to the current one). */
  async view(gid: string | null): Promise<void> {
    this.viewing = gid && gid !== this.groupId ? gid : null
    this.viewItems = this.viewing ? (await this.history.getItem(this.viewing)) ?? [] : []
    this.emit()
  }

  /** Always available: end the current conversation (if any) and start a new one. */
  async startNew(): Promise<void> {
    const old = this.groupId
    if (old) await this.endConversation(old, "user")
    this.group = null
    this.groupId = null
    this.items = []
    this.viewing = null
    this.emit()
    await this.start(old ?? undefined)
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    if (!this.destroyed) this.listeners.forEach((fn) => fn())
  }

  private log(msg: string) {
    console.log(`[support-chat] ${msg}`) // no secrets: pubkeys, ids, statuses only
  }

  /** F-M12-2: any engine-visible signal counts as liveness. */
  private noteEngineActivity() {
    this.engineActivityAt = Date.now()
  }

  /**
   * F-M12-2 mitigation: if transport delivered group traffic recently but the
   * engine produced nothing for 90s (or a subscription died), rebuild the client —
   * the fresh engine re-ingests from the store and recovers (proven on device).
   * Bounded at 3 re-inits per session, then surfaces a status instead.
   */
  private startStallWatcher() {
    this.stopStallWatcher()
    this.stallWatch = setInterval(() => {
      if (this.destroyed || this.reIniting) return
      const engineIdleMs = Date.now() - this.engineActivityAt
      const transportAlive = Date.now() - (this.network?.activity445At ?? 0) < 90_000
      if (engineIdleMs > 90_000 && transportAlive) {
        void this.reInit(
          `stall: engine silent ${Math.round(engineIdleMs / 1000)}s while transport delivering`,
        )
      }
    }, 30_000)
  }

  private stopStallWatcher() {
    if (this.stallWatch !== null) {
      clearInterval(this.stallWatch)
      this.stallWatch = null
    }
  }

  private async reInit(reason: string): Promise<void> {
    if (this.destroyed || this.reIniting) return
    if (this.reInits >= 3) {
      this.log(`recovery gave up after 3 re-inits (last reason: ${reason})`)
      this.status = "degraded"
      this.emit()
      return
    }
    this.reIniting = true
    this.reInits++
    this.status = "reconnecting"
    this.emit()
    this.log(`recovering (${reason}; re-init #${this.reInits})`)
    try {
      this.inviteWatch?.abort()
      this.conn?.unsubscribe()
      this.inviteListen?.unsubscribe()
      this.stopStallWatcher()
      for (const g of this.attached) await g.save(true).catch(() => undefined)
      await this.network?.destroy()
      this.attached.clear()
      this.group = null
      this.client = null
      this.network = null
      await this.init()
      this.log("recovered: client rebuilt")
    } catch (e) {
      this.log(`recovery failed: ${(e as Error).message}`)
    } finally {
      this.reIniting = false
    }
  }

  async init(): Promise<void> {
    const t0 = Date.now()
    ensureUrlCanParse() // app.tsx's URL polyfill ran, but be explicit (F-M6-3/F-M9-10)
    const signer = await createBlinkEventSigner(this.runtime)
    this.pubkey = await signer.getPublicKey()
    this.network = new SimplePoolNetwork({ signer, relays: SUPPORT_CHAT_RELAYS })
    // F-M12-2: a silently closed subscription = missed messages; rebuild.
    this.network.onSubClosed = (reason: unknown) => {
      if (!this.destroyed && !this.reIniting)
        void this.reInit(`subscription closed (${String(reason).slice(0, 40)})`)
    }
    const store = (prefix: string): any =>
      new EncryptedKeyValueStore(this.accountKey, prefix)
    this.client = new MarmotClient({
      signer,
      network: this.network,
      groupStateStore: store("groups:"),
      keyPackageStore: store("keypackages:"),
      inviteStore: store("invites:"),
      ingestStateStore: store("ingest:"), // durable pending pool (F-M9-5)
      removedMarkerStore: store("removed:"), // removal tombstones (F-M6-4 class)
      clientId: "blink-support-chat",
      cryptoProvider: hermesCryptoProvider, // pure JS: Hermes has no crypto.subtle (M2)
      // TEMP M12 debug (F-M12-2): forensic sink — where do the fetched commits die?
      audit: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        record: (e: any) => {
          if (
            [
              "ingest_entry",
              "ingest_outcome",
              "ingest_error",
              "epoch_confirmed",
              "epoch_rolled_back",
              "epoch_state_changed",
            ].includes(e?.type)
          )
            console.log(
              `[support-chat-audit] ${e.type} ${JSON.stringify(e).slice(0, 260)}`,
            )
        },
      },
      auditContext: { engineId: "phone-debug" },
    })
    this.roster = new RosterVerifier({
      rosterPubkey: SUPPORT_ROSTER_PUBKEY,
      network: this.network,
      relays: SUPPORT_CHAT_RELAYS,
      snapshot: ROSTER_SNAPSHOT,
      persistence: {
        load: () =>
          new EncryptedKeyValueStore<RosterPersisted>(this.accountKey, "roster:").getItem(
            "state",
          ),
        save: (state: RosterPersisted) =>
          new EncryptedKeyValueStore<RosterPersisted>(this.accountKey, "roster:").setItem(
            "state",
            state,
          ),
      },
      onChange: (r: any, prev: any) => {
        this.log(
          `roster ${prev ? "replaced" : "loaded"} ${short(r.id)}: ${r.members.size} members`,
        )
        // Revocation relabeling (03 §5: "as of now" default): warn when a current
        // member's verification changed with the new roster.
        if (prev && this.group) {
          const unverified = this.unverifiedMembers()
          if (unverified.length)
            void this.push({
              id: `roster-${r.id}`,
              at: now(),
              type: "warning",
              text: `Blink Support roster changed: ${unverified.map((m) => m.text).join("; ")}`,
            })
        }
        this.emit()
      },
    })
    this.meta = (await this.metaStore.getItem("meta")) ?? {}
    // restore()/refresh(): persisted floor + everListed first, snapshot seed, then relay
    const rosterStatus = await this.roster.refresh().catch((e: Error) => {
      // relay unreachable: restored/snapshot state still applies (offline restart)
      this.log(`roster refresh failed (${e.message}); restored state stands`)
      return this.roster.status()
    })
    this.rosterSub = this.roster.subscribe()
    this.log(
      `identity ${short(this.pubkey)}; roster ${short(SUPPORT_ROSTER_PUBKEY)}: ${rosterStatus}`,
    )

    // Be invitable: 30443 (ensurePublished, rotates) + 10051/10050/10002 (F-M9-12)
    await ensureDiscoverable(this.client, this.network, {
      relays: SUPPORT_CHAT_RELAYS,
      signer,
    })
    this.log("key package + relay lists published (30443/10051/10050/10002)")

    // Library inbound loop: backfill + live + dedupe + ingest for every group,
    // auto-connecting groups created/joined later (F-M9-5).
    this.client.groups.on("created", (g: AnyGroup) => this.attach(g))
    this.client.groups.on("joined", (g: AnyGroup) => this.attach(g))
    this.client.groups.on("removed", (gid: Uint8Array) => {
      this.noteEngineActivity()
      void this.pushTo(hex(gid), {
        id: `removed-${hex(gid)}`,
        at: now(),
        type: "warning",
        text: "You were removed from this chat",
      })
      void this.endConversation(hex(gid), "removed")
    })
    this.client.groups.on("unreadable", (_gid: Uint8Array, event: { id: string }) => {
      this.noteEngineActivity()
      this.log(`inbound ${short(event.id)} unreadable (dropped by connect())`)
    })
    this.client.groups.on(
      "rejected",
      (_gid: Uint8Array, event: { id: string }, reason: unknown) => {
        this.noteEngineActivity()
        this.log(`inbound ${short(event.id)} rejected at trust boundary (${reason})`)
      },
    )

    // Fault-tolerant load (F-M9-7 on 0.6.0): one unreadable group never fails start;
    // it becomes "could not be restored" + the support re-invite path (req 8).
    const { groups, failed } = (await loadGroups(this.client, {
      onError: (id: string, e: Error) =>
        this.log(`cannot load group ${short(id)}: ${e.message}`),
    })) as { groups: AnyGroup[]; failed: { id: string }[] }
    if (failed.length)
      await this.push({
        id: `restore-failed-${failed.map((f) => short(f.id)).join(",")}`,
        at: now(),
        type: "warning",
        text: `${failed.length} conversation(s) could not be restored after an app update (older library state). They stay read-only below; start a new chat to continue.`,
      })

    this.conn = this.client.groups.connectAll({ fallbackRelays: SUPPORT_CHAT_RELAYS })
    // The library's invite listener (1059 on our advertised inbox relays → ingest →
    // decrypt); watchInvites() below only watches the store — without listen(),
    // support-initited invites never arrive (M12 finding, fixed in the bot too).
    this.inviteListen = await this.client.invites.listen(SUPPORT_CHAT_RELAYS)
    const active = groups.find(
      (g) => g.groupData && hex(g.groupData.nostrGroupId) === this.meta.activeGroup,
    )
    if (active) {
      this.attach(active)
      this.items = (await this.history.getItem(this.meta.activeGroup as string)) ?? []
      this.log(
        `reloaded group ${short(this.groupId ?? "")} at epoch ${active.state.groupContext.epoch}, ${this.items.length} items (${Date.now() - t0}ms)`,
      )
    } else if (this.meta.activeGroup) {
      // The conversation's MLS state is gone or unreadable; its stored history is not.
      // Option C: it becomes an ENDED conversation (readable, "start a new one").
      const old = this.meta.activeGroup
      this.groupId = old
      this.items = (await this.history.getItem(old)) ?? []
      this.log(`active group ${short(old)} not restorable`)
      ;(this.meta.conversations ??= {})[old] ??= {
        gid: old,
        startedAt: this.items[0]?.at ?? now(),
        status: "active",
      }
      await this.endConversation(old, "unrestorable")
    }
    void this.watchForInvites()
    this.startStallWatcher()
    this.status = "ready"
    this.emit()
  }

  /** Support-initiated conversations: the library's invite watch loop (live + backfill). */
  private async watchForInvites(): Promise<void> {
    if (this.destroyed) return
    this.inviteWatch = new AbortController()
    try {
      for await (const invites of this.client.watchInvites()) {
        for (const { invite, joinable } of invites) {
          if (!joinable) continue
          try {
            // UnreadInvite extends Rumor — the invite IS the welcome rumor.
            const { group } = await this.client.joinGroupFromWelcome({
              welcomeRumor: invite,
            })
            await this.client.invites.markAsRead(invite.id)
            this.attach(group)
            this.push({
              id: `joined-${invite.id}`,
              at: now(),
              type: "notice",
              text: `Joined a conversation started by support (${this.members().length + 1} members)`,
            })
          } catch (e) {
            this.log(`invite ${short(invite.id)} failed to join: ${(e as Error).message}`)
          }
        }
      }
    } catch (e) {
      if (!this.destroyed) this.log(`invite watch ended: ${(e as Error).message}`)
    }
  }

  rosterStatus(): string {
    const s = this.roster?.status() ?? "none"
    const r = this.roster?.current
    return r ? `${s} · ${r.members.size} members · ${short(r.id)}` : s
  }

  label(pubkey: string): MemberLabel {
    if (!this.roster) return { pubkey, text: short(pubkey), verified: false }
    const l = this.roster.label(pubkey)
    return {
      pubkey,
      text: this.roster.display(pubkey),
      verified: l.verified,
      role: l.role,
    }
  }

  members(): MemberLabel[] {
    if (!this.group) return []
    return getGroupMembers(this.group.state)
      .filter((pk: string) => pk !== this.pubkey)
      .map((pk: string) => this.label(pk))
  }

  /** Req 12: who is answering right now — a human agent present, or the automated bot. */
  handoffState(): "agent" | "bot" {
    return this.members().some((m) => m.verified && m.role === "agent") ? "agent" : "bot"
  }

  /**
   * Policy default (03 §5, patternn "add" risk point): while an UNVERIFIED member is
   * in the conversation, warn AND block sending. Returns the offending members (the
   * screen composes the warning); null when sending is allowed.
   */
  unverifiedMembers(): MemberLabel[] {
    return this.members().filter((m) => !m.verified)
  }

  /**
   * Start a conversation with the support bot named on the roster. `supersedes`: the
   * conversation this one replaces (Option C) — named on the first rumor so support
   * closes the old thread.
   */
  async start(supersedes?: string): Promise<void> {
    if (this.group) return
    if (this.roster.status() !== "valid")
      throw new Error(
        `no valid Blink Support roster (${this.roster.status()}) — not starting`,
      )
    const bots = [...this.roster.current.members].filter(([, m]: any) => m.role === "bot")
    if (bots.length !== 1)
      throw new Error(`the roster lists ${bots.length} support bots, expected 1`)
    const [botPk] = bots[0] as [string, unknown]
    const kp = await fetchKeyPackageEvent(this.network, SUPPORT_CHAT_RELAYS, botPk)
    if (!kp) throw new Error("the support bot has no key package on the relay")
    const t0 = Date.now()
    const group = await this.client.groups.create("Blink support", {
      relays: SUPPORT_CHAT_RELAYS,
      adminPubkeys: [botPk], // the bot can hand off to an agent (F-M4-6a)
    })
    this.attach(group)
    await this.client.groups.invite(group.id, kp)
    this.log(
      `group ${short(this.groupId ?? "")} created, bot ${short(botPk)} invited (${Date.now() - t0}ms)`,
    )
    await this.push({
      id: `n-${Date.now()}`,
      at: now(),
      type: "notice",
      text: `Conversation started with ${this.roster.display(botPk)}`,
    })
    if (supersedes)
      await this.client.groups.send(
        group.id,
        createApplicationMessageIntent(
          createChatRumor({
            pubkey: this.pubkey,
            content: "(new conversation — my previous one ended on this device)",
            tags: [["supersedes", supersedes]],
          }),
        ),
      )
  }

  async send(text: string): Promise<void> {
    const group = this.group
    if (!group || !text.trim()) return
    if (this.isEnded()) throw new Error("this conversation has ended — start a new one")
    // Policy default: warn + BLOCK while an unverified member is present (03 §5).
    const unverified = this.unverifiedMembers()
    if (unverified.length)
      throw new Error(`sending blocked: ${unverified.map((m) => m.text).join("; ")}`)
    const t0 = Date.now()
    await this.client.groups.send(
      group.id,
      createApplicationMessageIntent(
        createChatRumor({ pubkey: this.pubkey, content: text.trim() }),
      ),
    )
    this.log(`sent (${Date.now() - t0}ms)`)
    await this.push({
      id: `m-${Date.now()}`,
      at: now(),
      type: "msg",
      from: this.pubkey,
      mine: true,
      text: text.trim(),
    })
  }

  /** One group is "the" conversation (P1: a single active support conversation). */
  private attach(group: AnyGroup) {
    if (!group?.groupData || this.attached.has(group)) return
    this.attached.add(group)
    const gid = hex(group.groupData.nostrGroupId)
    // Option C: a newly attached conversation (created, or support-initiated) replaces
    // the current one, which ends; its record is created on first attach.
    if (this.groupId && this.groupId !== gid)
      void this.endConversation(this.groupId, "replaced")
    const conversations = (this.meta.conversations ??= {})
    conversations[gid] ??= { gid, startedAt: now(), status: "active" }
    this.group = group
    this.groupId = gid
    // Membership notices (req 5): baseline = who is here at attach time.
    this.knownMembers.set(gid, new Set<string>(getGroupMembers(group.state)))
    group.on("stateChanged", (state: { groupContext: { epoch: bigint } }) => {
      this.noteEngineActivity()
      // TEMP M12 debug (F-M12-2): epoch visibility on device
      console.log(`[support-chat] ${gid.slice(0, 8)} epoch ${state.groupContext.epoch}`)
      void this.membershipNotices(gid, state)
    })
    group.on("applicationMessage", (data: Uint8Array) => {
      this.noteEngineActivity()
      // TEMP M12 debug (F-M12-2): engine-level receipt signal for the repro loop
      try {
        const r = deserializeApplicationData(data)
        console.log(
          `[support-chat] recv ${r.pubkey.slice(0, 8)} len=${r.content?.length ?? -1}`,
        )
      } catch {
        console.log("[support-chat] recv (undecodable)")
      }
      // v2: the engine already bound the rumor's author to the MLS sender leaf
      // (F-M9-3) — anything delivered here is authenticated to its sender.
      try {
        const rumor = deserializeApplicationData(data)
        if (rumor.pubkey === this.pubkey) return
        void this.pushTo(gid, {
          id: `r-${rumor.id}`,
          at: now(),
          type: "msg",
          from: rumor.pubkey,
          text: rumor.content,
        })
      } catch (e) {
        this.log(`applicationMessage dropped by strict decode: ${(e as Error).message}`)
      }
    })
    this.meta.activeGroup = gid
    void this.saveMeta()
    this.emit()
  }

  /** Req 5: every membership change is shown ("X joined", "X left"), roster-labelled. */
  private async membershipNotices(gid: string, state: unknown) {
    try {
      const members = new Set<string>(getGroupMembers(state as AnyGroup["state"]))
      const known = this.knownMembers.get(gid) ?? new Set<string>()
      const joined = [...members].filter((pk) => !known.has(pk))
      const left = [...known].filter((pk) => !members.has(pk))
      this.knownMembers.set(gid, members)
      const at = now()
      for (const pk of joined)
        if (pk !== this.pubkey)
          await this.pushTo(gid, {
            id: `mn-j-${gid}-${pk}-${at}`,
            at,
            type: "notice",
            text: `joined: ${this.label(pk).text}`,
          })
      for (const pk of left)
        await this.pushTo(gid, {
          id: `mn-l-${gid}-${pk}-${at}`,
          at,
          type: "notice",
          text:
            pk === this.pubkey
              ? "You were removed from this chat"
              : `left: ${this.label(pk).text}`,
        })
    } catch (e) {
      this.log(`membership notice error: ${(e as Error).message}`)
    }
  }

  private async push(item: ChatItem) {
    if (this.groupId) return this.pushTo(this.groupId, item)
    // no conversation yet (e.g. the restore-failed warning at start): memory only
    if (!this.items.some((x) => x.id === item.id))
      this.items = [...this.items, item].slice(-MAX_ITEMS)
    this.emit()
  }

  /** Append to a conversation's history; only the current one is in memory. */
  private async pushTo(gid: string, item: ChatItem) {
    if (gid !== this.groupId) {
      // an older (ended) conversation still receiving: keep its history complete
      const old = (await this.history.getItem(gid)) ?? []
      if (old.some((x) => x.id === item.id)) return
      await this.history.setItem(gid, [...old, item].slice(-MAX_ITEMS))
      return
    }
    if (this.items.some((x) => x.id === item.id)) return
    this.items = [...this.items, item].slice(-MAX_ITEMS)
    this.emit()
    await this.history.setItem(gid, this.items)
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    anomalyListeners.delete(this.onAnomaly)
    if (this.stuckTimer) clearTimeout(this.stuckTimer)
    this.stopStallWatcher()
    this.inviteWatch?.abort()
    this.conn?.unsubscribe()
    this.inviteListen?.unsubscribe()
    this.rosterSub?.unsubscribe()
    if (this.group) await this.group.save(true).catch(() => undefined)
    await this.network?.destroy()
  }
}
