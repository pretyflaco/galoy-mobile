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
  encodeMediaImetaTag,
  getGroupMembers,
  getMediaAttachments,
} from "@internet-privacy/marmot-ts"
import RNFS from "react-native-fs"
import { hermesCryptoProvider } from "@blink-support-chat/adapters/hermes-crypto-provider.js"
import { SimplePoolNetwork } from "@blink-support-chat/adapters/network.js"
import { RosterVerifier } from "@blink-support-chat/adapters/roster.js"
import { loadGroups } from "@blink-support-chat/adapters/load-groups.js"
import {
  ensureDiscoverable,
  fetchKeyPackageEvent,
} from "@blink-support-chat/adapters/key-package-publish.js"

import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native"
import messaging from "@react-native-firebase/messaging"

import { ensureUrlCanParse } from "@app/polyfills/url-can-parse"

import { SUPPORT_ROSTER_PUBKEY, ROSTER_SNAPSHOT } from "./roster-config"
import {
  PUSH_SERVER_PUBKEY,
  announcementKey,
  buildTokenAnnouncement,
  getPushToken,
} from "./push"
import type { BlinkEventSigner } from "./blink-signer"
import { SUPPORT_SCOPE, createSupportSigner, loadOrCreateSupportKey } from "./support-key"
import { EncryptedKeyValueStore } from "./encrypted-store"
import { isDetailsMessage, requestOf, type RequestKind } from "./details"
import { groupAdminsIncludeBot, inviteAcceptable } from "./invite-policy"
import { supportChatLog } from "./log"
import {
  MAX_DOWNLOAD_BYTES,
  allowedBlobUrl,
  blobLike,
  ensureLiveImage,
  ensureLiveImages,
  imageExt,
  imageWithinPixelCap,
  migratePlaintextMedia,
  storeSealedImage,
  uploadEncryptedBlob,
  wipeLiveImages,
} from "./media"

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
  /** M19 "Share details": this message is a details card the customer shared */
  details?: boolean
  /** M19: the verified support bot asks for details ("details" | "tx") */
  request?: RequestKind
  /** M19: a screenshot this device sent — a private local copy (file path, size) */
  image?: { path: string; width?: number; height?: number }
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
/** "identity": a conversation from before the device support key (M19), kept read-only. */
export type EndReason =
  | "user"
  | "stuck"
  | "removed"
  | "unrestorable"
  | "replaced"
  | "identity"
export type Conversation = {
  gid: string
  startedAt: number
  status: "active" | "ended"
  endedAt?: number
  reason?: EndReason
  /** M19: shown in the Conversations list — the user's first message, shortened */
  title?: string
}
type Meta = {
  activeGroup?: string
  conversations?: Record<string, Conversation>
  /** M18: per conversation, the push announcement already sent (announcementKey) */
  pushAnnounced?: Record<string, string>
  /** messages from support not yet seen on the chat screen (current conversation) */
  unread?: number
  /** M19: accounts whose Nostr-identity conversations were imported read-only */
  importedAccounts?: string[]
}

/** M19: a conversation's list title from the user's first message. */
export const titleFrom = (text: string): string => {
  const line = text.trim().split("\n")[0].trim()
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line
}

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
  private signer: BlinkEventSigner | null = null
  private tokenRefreshSub: (() => void) | null = null
  // F-M18-7: Android closes the relay sockets of a backgrounded app. A close seen in
  // the background is remembered and repaired when the app is in front again (a
  // reconnect in the background would just be closed again).
  private appStateSub: NativeEventSubscription | null = null
  private backgroundSince: number | null = null
  private closedInBackground = false
  private screenFocused = false

  /**
   * M19: one client per DEVICE, on the device's own support key (support-key.ts) — no
   * Nostr identity and no account needed. `scope` exists for tests.
   */
  constructor(private readonly scope: string = SUPPORT_SCOPE) {
    this.metaStore = new EncryptedKeyValueStore<Meta>(scope, "meta:")
    this.history = new EncryptedKeyValueStore<ChatItem[]>(scope, "history:")
    anomalyListeners.add(this.onAnomaly)
    this.appStateSub = AppState.addEventListener("change", (s) => this.onAppState(s))
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
      this.endConversation(gid, "stuck")
    }, STUCK_GRACE_MS)
  }

  /** Open a past conversation read-only (null = back to the current one). */
  async view(gid: string | null): Promise<void> {
    this.viewing = gid && gid !== this.groupId ? gid : null
    this.viewItems = this.viewing ? (await this.history.getItem(this.viewing)) ?? [] : []
    await ensureLiveImages(this.scope, this.viewItems)
    this.emit()
  }

  /**
   * M20 (D2): make a parked support-initiated conversation the current one. The
   * previous conversation is NOT ended — it stays active and keeps receiving into its
   * history. Returns false when there is no live group for gid (ended/unrestorable —
   * the caller falls back to the read-only view()).
   */
  async switchTo(gid: string): Promise<boolean> {
    // Hermes #2: never switch mid-ensureConversation (the greeting wait watches items)
    if (this.ensurePromise) await this.ensurePromise.catch(() => undefined)
    if (this.meta.conversations?.[gid]?.status === "ended") return false
    const group = [...this.attached].find(
      (g: AnyGroup) => g.groupData && hex(g.groupData.nostrGroupId) === gid,
    )
    if (!group) return false
    if (this.groupId === gid) return true
    if (this.viewing) await this.view(null)
    this.group = group
    this.groupId = gid
    this.items = (await this.history.getItem(gid)) ?? []
    await ensureLiveImages(this.scope, this.items)
    this.meta.activeGroup = gid
    await this.saveMeta()
    this.emit()
    this.announcePush()
    return true
  }

  /**
   * M19 "Share details" from outside the chat (e.g. a transaction's detail screen): make
   * sure there is a conversation the support bot has joined before sending into it —
   * a message sent before the bot's join can be lost (F-M12-1). Starts one if needed and
   * waits for the first message from support (the greeting).
   * M20: serialized — two concurrent calls (a tap + a share) must not race past
   * `start()`'s `if (this.group) return` and create TWO conversations (the suspected
   * M19 A56 duplicate, 6ad3fd43).
   */
  async ensureConversation(timeoutMs = 45_000): Promise<void> {
    this.ensurePromise ??= this.ensureConversationOnce(timeoutMs).finally(() => {
      this.ensurePromise = null
    })
    return this.ensurePromise
  }

  private ensurePromise: Promise<void> | null = null

  private async ensureConversationOnce(timeoutMs: number): Promise<void> {
    if (this.viewing) await this.view(null)
    if (!this.group || this.isEnded()) {
      if (this.groupId) await this.startNew()
      else await this.start()
    }
    const t0 = Date.now()
    while (!this.items.some((i) => i.type === "msg" && !i.mine)) {
      if (Date.now() - t0 > timeoutMs)
        throw new Error("Support has not answered yet — please try again in a moment.")
      await new Promise<void>((r) => {
        setTimeout(r, 500)
      })
    }
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
    supportChatLog(msg) // no secrets: pubkeys, ids, statuses only
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
        this.reInit(
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

  /**
   * Rebuild the client. `counted` re-inits (stalls, foreground socket loss) share a
   * budget of 3 per session; the foreground reconnect after a background is routine on
   * Android and does not spend it (F-M18-7).
   */
  private async reInit(reason: string, { counted = true } = {}): Promise<void> {
    if (this.destroyed || this.reIniting) return
    if (counted && this.reInits >= 3) {
      this.log(`recovery gave up after 3 re-inits (last reason: ${reason})`)
      this.status = "degraded"
      this.emit()
      return
    }
    this.reIniting = true
    if (counted) this.reInits += 1
    this.status = "reconnecting"
    this.emit()
    this.log(`recovering (${reason}${counted ? `; re-init #${this.reInits}` : ""})`)
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
    // P7: no committed roster default — a build without one fails closed, up front
    if (!SUPPORT_ROSTER_PUBKEY)
      throw new Error("support chat: no roster key in this build")
    const signer = createSupportSigner(await loadOrCreateSupportKey())
    this.signer = signer
    this.pubkey = await signer.getPublicKey()
    this.network = new SimplePoolNetwork({ signer, relays: SUPPORT_CHAT_RELAYS })
    // F-M12-2: a silently closed subscription = missed messages; rebuild.
    this.network.onSubClosed = (reason: unknown) => {
      if (this.destroyed || this.reIniting) return
      if (AppState.currentState !== "active") {
        this.closedInBackground = true // repaired on foreground (onAppState)
        return
      }
      this.reInit(`subscription closed (${String(reason).slice(0, 60)})`)
    }
    const store = (prefix: string): any => new EncryptedKeyValueStore(this.scope, prefix)
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
    })
    this.roster = new RosterVerifier({
      rosterPubkey: SUPPORT_ROSTER_PUBKEY,
      network: this.network,
      relays: SUPPORT_CHAT_RELAYS,
      snapshot: ROSTER_SNAPSHOT,
      persistence: {
        load: () =>
          new EncryptedKeyValueStore<RosterPersisted>(this.scope, "roster:").getItem(
            "state",
          ),
        save: (state: RosterPersisted) =>
          new EncryptedKeyValueStore<RosterPersisted>(this.scope, "roster:").setItem(
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
            this.push({
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
    await this.backfillTitles()
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

    // M20 (finding 3): seal the plaintext pictures earlier versions wrote to Documents,
    // delete the plaintext; shadows of the current conversation are (re)made below.
    const sealed = await migratePlaintextMedia(this.scope).catch(() => -1)
    if (sealed > 0) this.log(`sealed ${sealed} plaintext picture(s), originals deleted`)
    // Hermes #5: shadows from a previous run (crash/kill while in front) never survive start
    wipeLiveImages()

    // Library inbound loop: backfill + live + dedupe + ingest for every group,
    // auto-connecting groups created/joined later (F-M9-5).
    this.client.groups.on("created", (g: AnyGroup) => this.attach(g))
    // M20 (D2): a group joined from an invite is PARKED first — watchForInvites()
    // alone decides (after its roster-bot gate) whether it becomes the current one.
    this.client.groups.on("joined", (g: AnyGroup) => this.attach(g, { activate: false }))
    this.client.groups.on("removed", (gid: Uint8Array) => {
      this.noteEngineActivity()
      this.pushTo(hex(gid), {
        id: `removed-${hex(gid)}`,
        at: now(),
        type: "warning",
        text: "You were removed from this chat",
      })
      this.endConversation(hex(gid), "removed")
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
      await ensureLiveImages(this.scope, this.items)
      this.log(
        `reloaded group ${short(this.groupId ?? "")} at epoch ${active.state.groupContext.epoch}, ${this.items.length} items (${Date.now() - t0}ms)`,
      )
    } else if (this.meta.activeGroup) {
      // The conversation's MLS state is gone or unreadable; its stored history is not.
      // Option C: it becomes an ENDED conversation (readable, "start a new one").
      const old = this.meta.activeGroup
      this.groupId = old
      this.items = (await this.history.getItem(old)) ?? []
      await ensureLiveImages(this.scope, this.items)
      this.log(`active group ${short(old)} not restorable`)
      ;(this.meta.conversations ??= {})[old] ??= {
        gid: old,
        startedAt: this.items[0]?.at ?? now(),
        status: "active",
      }
      await this.endConversation(old, "unrestorable")
    }
    // M20 (D2): parked support-initiated conversations (joined, never made current)
    // get their listeners back so their history stays complete across restarts.
    for (const g of groups) {
      const gid = g.groupData ? hex(g.groupData.nostrGroupId) : null
      if (
        gid &&
        gid !== this.groupId &&
        this.meta.conversations?.[gid]?.status === "active"
      )
        this.attach(g, { activate: false })
    }
    this.watchForInvites()
    this.startStallWatcher()
    this.status = "ready"
    this.emit()
    if (PUSH_SERVER_PUBKEY && !this.tokenRefreshSub)
      this.tokenRefreshSub = messaging().onTokenRefresh(() => this.announcePush())
    this.announcePush()
  }

  /**
   * M18: announce this device's push token in the current conversation (kind 447,
   * marmot-push-v1) once per token/leaf/server; re-announced on token refresh and for
   * every new conversation. Best effort: push is optional, chat never depends on it.
   */
  async announcePush(): Promise<void> {
    const group = this.group
    const gid = this.groupId
    if (!PUSH_SERVER_PUBKEY || !group || !gid || !this.signer || this.isEnded()) return
    // M20 (finding 2): never announce into a group the verified roster bot does not
    // admin — a member holding the token record can make Transponder wake this device.
    if (
      !groupAdminsIncludeBot(group.groupData?.adminPubkeys ?? [], (pk) => this.label(pk))
    ) {
      this.log(`push: not announced in ${short(gid)}: the roster bot is not an admin`)
      return
    }
    try {
      const token = await getPushToken()
      if (!token) return
      const leafIndex: number = group.state.privatePath.leafIndex
      const key = announcementKey(token, leafIndex)
      if (this.meta.pushAnnounced?.[gid] === key) return
      const rumor = await buildTokenAnnouncement({
        signer: this.signer,
        pubkey: this.pubkey,
        groupIdHex: hex(group.state.groupContext.groupId),
        leafIndex,
        token,
        relayHint: SUPPORT_CHAT_RELAYS[0],
      })
      await this.client.groups.send(group.id, createApplicationMessageIntent(rumor))
      this.meta.pushAnnounced = { ...this.meta.pushAnnounced, [gid]: key }
      await this.saveMeta()
      this.log(`push: ${token.platform} token announced in ${short(gid)}`)
    } catch (e) {
      this.log(`push: announcement failed: ${(e as Error).message}`)
    }
  }

  /**
   * Support-initiated conversations: the library's invite watch loop (live + backfill).
   * M20 (D1/D2): an invite is accepted ONLY from the verified roster bot (its pubkey
   * is authenticated by the NIP-59 gift-wrap seal — PoC C6, findings/M20-security.md)
   * and ONLY into a group the roster bot admins (checked pre-join via previewWelcome).
   * Anything else is marked read, logged (pubkey prefix only) and never joined. An
   * accepted invite NEVER ends the active conversation: with none/ended it becomes
   * current; with one active it is parked as a second, inactive conversation (the
   * Conversations screen switches to it via switchTo()).
   */
  private async watchForInvites(): Promise<void> {
    if (this.destroyed) return
    this.inviteWatch = new AbortController()
    try {
      for await (const invites of this.client.watchInvites()) {
        for (const { invite } of invites.filter(
          (i: { joinable: boolean }) => i.joinable,
        )) {
          try {
            const preview = await this.client.previewWelcome(invite)
            // Hermes #6: previewWelcome swallows errors. "No group info" is NOT the
            // same as "the bot is not an admin" — a transient read failure must not
            // delete a legitimate support invite. Leave it unread; the watch retries.
            if (!preview?.group) {
              this.log(
                `invite ${short(invite.id)}: group info unreadable — kept for retry`,
              )
            } else if (
              inviteAcceptable(invite.pubkey, preview.group.adminPubkeys ?? [], (pk) =>
                this.label(pk),
              )
            ) {
              await this.joinInvitedGroup(invite)
            } else {
              await this.client.invites.markAsRead(invite.id)
              this.log(
                `invite from ${short(invite.pubkey)} refused: not a roster-bot, bot-admined group`,
              )
            }
          } catch (e) {
            this.log(`invite ${short(invite.id)} failed to join: ${(e as Error).message}`)
          }
        }
      }
    } catch (e) {
      if (!this.destroyed) this.log(`invite watch ended: ${(e as Error).message}`)
    }
  }

  /**
   * Join a roster-bot invite that passed the gate. D2: it NEVER ends the active
   * conversation — with none/ended it becomes current (notice + push announcement),
   * with one active it is parked and the notice lands in its own history.
   */
  private async joinInvitedGroup(invite: { id: string; pubkey: string }): Promise<void> {
    // UnreadInvite extends Rumor — the invite IS the welcome rumor.
    const { group } = await this.client.joinGroupFromWelcome({
      welcomeRumor: invite,
    })
    await this.client.invites.markAsRead(invite.id)
    const gid = hex(group.groupData.nostrGroupId)
    const hasActive = Boolean(this.groupId) && !this.isEnded()
    this.attach(group, { activate: !hasActive })
    const notice: ChatItem = {
      id: `joined-${invite.id}`,
      at: now(),
      type: "notice",
      text: `Joined a conversation started by support (${
        getGroupMembers(group.state).length
      } members)`,
    }
    if (hasActive) {
      // parked: the active ticket is untouched
      this.log(`support-initiated conversation ${short(gid)} parked (one is active)`)
      await this.pushTo(gid, notice)
    } else {
      this.items = (await this.history.getItem(gid)) ?? []
      this.announcePush()
      await this.push(notice)
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
    // a new conversation is the one on screen, also when started from a read-only one
    if (this.viewing) await this.view(null)
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
    this.announcePush() // after the invite commit: the bot can read it
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

  async send(text: string, tags: string[][] = []): Promise<void> {
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
        createChatRumor({ pubkey: this.pubkey, content: text.trim(), tags }),
      ),
    )
    this.log(`sent (${Date.now() - t0}ms)`)
    const record = this.current()
    if (record && !record.title) {
      record.title = titleFrom(text)
      await this.saveMeta()
    }
    await this.push({
      id: `m-${Date.now()}`,
      at: now(),
      type: "msg",
      from: this.pubkey,
      mine: true,
      text: text.trim(),
      ...(isDetailsMessage(tags) ? { details: true } : {}),
    })
  }

  /**
   * M19 screenshots (Marmot encrypted-media v1): encrypt with a key from this
   * conversation's MLS secret, upload only the ciphertext to Blossom, send a message with
   * the `imeta` tag. A private copy of the (already resized) image stays in the app's
   * document directory so the customer's own chat can show it.
   */
  async sendImage(
    bytes: Uint8Array,
    opts: { mime: string; width?: number; height?: number; caption?: string },
  ): Promise<void> {
    const group = this.group
    const signer = this.signer
    if (!group || !signer) throw new Error("no conversation")
    if (this.isEnded()) throw new Error("this conversation has ended — start a new one")
    const unverified = this.unverifiedMembers()
    if (unverified.length)
      throw new Error(`sending blocked: ${unverified.map((m) => m.text).join("; ")}`)
    const ext = opts.mime === "image/png" ? "png" : "jpg"
    const { encrypted, attachment } = await group.encryptMedia(
      blobLike(bytes, opts.mime),
      {
        filename: `screenshot.${ext}`,
        type: opts.mime,
        ...(opts.width && opts.height ? { dim: `${opts.width}x${opts.height}` } : {}),
      },
    )
    const url = await uploadEncryptedBlob(signer, encrypted)
    attachment.locators.push({ kind: "blossom-v1", value: url })
    const text = opts.caption?.trim() || "📷 Screenshot"
    const t0 = Date.now()
    await this.client.groups.send(
      group.id,
      createApplicationMessageIntent(
        createChatRumor({
          pubkey: this.pubkey,
          content: text,
          tags: [encodeMediaImetaTag(attachment)],
        }),
      ),
    )
    this.log(`sent image ${bytes.length} bytes (${Date.now() - t0}ms)`)
    // M20 (finding 3): sealed canonical copy in Caches; a short-lived plaintext shadow
    // for display — never a plaintext file in (iCloud-backed-up) Documents.
    const name = `${attachment.plaintextSha256}.${ext}`
    await storeSealedImage(this.scope, name, bytes)
    await ensureLiveImage(this.scope, name)
    await this.push({
      id: `m-${Date.now()}`,
      at: now(),
      type: "msg",
      from: this.pubkey,
      mine: true,
      text,
      image: { path: name, width: opts.width, height: opts.height },
    })
  }

  /**
   * M19 phase 2: download a picture support sent (only from Blink's Blossom), decrypt it
   * with this conversation's media key (marmot-ts checks both hashes), keep a private copy
   * and attach it to its message.
   */
  private async receiveImage({
    gid,
    itemId,
    group,
    attachment,
  }: {
    gid: string
    itemId: string
    group: AnyGroup
    attachment: ReturnType<typeof getMediaAttachments>[number]
  }): Promise<void> {
    const loc = attachment.locators.find(
      (l) => l.kind === "blossom-v1" && allowedBlobUrl(l.value),
    )
    if (!loc) throw new Error("no allowed blob locator")
    const tmp = `${RNFS.CachesDirectoryPath}/support-in-${attachment.ciphertextSha256}`
    const dl = await RNFS.downloadFile({ fromUrl: loc.value, toFile: tmp }).promise
    try {
      if (dl.statusCode !== 200) throw new Error(`blob fetch HTTP ${dl.statusCode}`)
      if (dl.bytesWritten > MAX_DOWNLOAD_BYTES) throw new Error("blob too large")
      const encrypted = new Uint8Array(
        Buffer.from(await RNFS.readFile(tmp, "base64"), "base64"),
      )
      const { data } = await group.decryptMedia(encrypted, attachment)
      const ext = imageExt(data)
      if (!ext) throw new Error("not a picture")
      // M20: refuse decompression bombs (decoded dimensions from the header)
      if (!imageWithinPixelCap(data)) throw new Error("picture dimensions not accepted")
      // M20: sealed at rest (Caches), plaintext shadow only for display
      const name = `${attachment.plaintextSha256}.${ext}`
      await storeSealedImage(this.scope, name, data)
      await ensureLiveImage(this.scope, name)
      const [width, height] = (attachment.dim ?? "").split("x").map(Number)
      await this.updateItem(gid, itemId, {
        image: { path: name, ...(width && height ? { width, height } : {}) },
      })
      this.log(`image received ${data.length} bytes`)
    } finally {
      await RNFS.unlink(tmp).catch(() => undefined)
    }
  }

  /** Merge fields into a stored chat item (current conversation or its history). */
  private async updateItem(gid: string, id: string, patch: Partial<ChatItem>) {
    if (gid === this.groupId) {
      this.items = this.items.map((x) => (x.id === id ? { ...x, ...patch } : x))
      this.emit()
      await this.history.setItem(gid, this.items)
      return
    }
    const old = (await this.history.getItem(gid)) ?? []
    await this.history.setItem(
      gid,
      old.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    )
  }

  /**
   * One group is "the" conversation (P1: a single active support conversation).
   * `activate: false` (M20, D2) wires the listeners and registers the conversation
   * but leaves the CURRENT one untouched — a support-initiated invite is parked as a
   * second, inactive conversation and never ends the active ticket. An already
   * attached group can still be activated later (the "joined" event parks first,
   * watchForInvites() then decides).
   */
  private attach(group: AnyGroup, opts?: { activate?: boolean }) {
    if (!group?.groupData) return
    const gid = hex(group.groupData.nostrGroupId)
    const activate = opts?.activate ?? true
    if (!this.attached.has(group)) {
      this.attached.add(group)
      this.meta.conversations ??= {}
      this.meta.conversations[gid] ??= { gid, startedAt: now(), status: "active" }
      // Membership notices (req 5): baseline = who is here at attach time.
      this.knownMembers.set(gid, new Set<string>(getGroupMembers(group.state)))
      group.on("stateChanged", (state: { groupContext: { epoch: bigint } }) => {
        this.noteEngineActivity()
        this.membershipNotices(gid, state)
      })
      group.on("applicationMessage", (data: Uint8Array) => {
        this.noteEngineActivity()
        // v2: the engine already bound the rumor's author to the MLS sender leaf
        // (F-M9-3) — anything delivered here is authenticated to its sender.
        try {
          const rumor = deserializeApplicationData(data)
          if (rumor.pubkey === this.pubkey) return
          // only chat (kind 9) is shown; app payloads such as push token gossip
          // (447/448/449) from other members' clients are not messages (M18)
          if (rumor.kind !== 9) return
          // a details request counts only from the verified roster bot (M19)
          const asker = this.label(rumor.pubkey)
          const request =
            asker.verified && asker.role === "bot" ? requestOf(rumor.tags) : null
          const itemId = `r-${rumor.id}`
          this.pushTo(gid, {
            id: itemId,
            at: now(),
            type: "msg",
            from: rumor.pubkey,
            text: rumor.content,
            ...(request ? { request } : {}),
            ...(isDetailsMessage(rumor.tags) ? { details: true } : {}),
          })
          // M19 phase 2: a picture from Blink Support — only from verified members
          if (asker.verified) {
            const attachment = getMediaAttachments(rumor.tags ?? [])[0]
            if (attachment)
              this.receiveImage({ gid, itemId, group, attachment }).catch((e) =>
                this.log(`image not shown: ${(e as Error).message}`),
              )
          }
        } catch (e) {
          this.log(`applicationMessage dropped by strict decode: ${(e as Error).message}`)
        }
      })
    }
    if (!activate) {
      this.saveMeta()
      this.emit()
      return
    }
    // Option C: a newly activated conversation (created, or support-initiated with no
    // active one) replaces the current one, which ends.
    if (this.groupId && this.groupId !== gid)
      this.endConversation(this.groupId, "replaced")
    this.group = group
    this.groupId = gid
    this.meta.activeGroup = gid
    this.saveMeta()
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
            text: `Joined: ${this.label(pk).text}`,
          })
      for (const pk of left)
        await this.pushTo(gid, {
          id: `mn-l-${gid}-${pk}-${at}`,
          at,
          type: "notice",
          text:
            pk === this.pubkey
              ? "You were removed from this chat"
              : `Left: ${this.label(pk).text}`,
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
  /** Unseen messages from support in the current conversation (settings badge). */
  get unread(): number {
    return this.meta.unread ?? 0
  }

  /** The chat screen is (not) in front: while it is, nothing counts as unread. */
  setScreenFocused(focused: boolean): void {
    this.screenFocused = focused
    if (focused && this.unread) {
      this.meta.unread = 0
      this.saveMeta()
      this.emit()
    }
  }

  /** M19: conversations from before titles existed get one from their stored history. */
  private async backfillTitles() {
    let changed = false
    const untitled = Object.values(this.meta.conversations ?? {}).filter((c) => !c.title)
    for (const c of untitled) {
      const items = (await this.history.getItem(c.gid).catch(() => null)) ?? []
      const first = items.find((i) => i.type === "msg" && i.mine)
      if (first) {
        c.title = titleFrom(first.text)
        changed = true
      }
    }
    if (changed) await this.saveMeta()
  }

  /**
   * M19 migration: the account's conversations from the Nostr-identity era (stored under
   * the account scope) are copied into this device's list as ENDED, read-only history
   * ("identity"). Their MLS state is left where it was and never loaded: the device's
   * support key is not a member of those groups. Runs once per account.
   */
  async importLegacy(accountKey: string): Promise<number> {
    if (!accountKey || accountKey === this.scope) return 0
    if (this.meta.importedAccounts?.includes(accountKey)) return 0
    const legacyMeta = await new EncryptedKeyValueStore<Meta>(accountKey, "meta:")
      .getItem("meta")
      .catch(() => null)
    const legacyHistory = new EncryptedKeyValueStore<ChatItem[]>(accountKey, "history:")
    let imported = 0
    this.meta.conversations ??= {}
    const conversations = this.meta.conversations
    const legacy = Object.values(legacyMeta?.conversations ?? {}).filter(
      (c) => !conversations[c.gid],
    )
    for (const c of legacy) {
      const items = (await legacyHistory.getItem(c.gid).catch(() => null)) ?? []
      await this.history.setItem(c.gid, items)
      const first = items.find((i) => i.type === "msg" && i.mine)
      conversations[c.gid] = {
        ...c,
        status: "ended",
        reason: c.status === "ended" ? c.reason : "identity",
        endedAt: c.endedAt ?? now(),
        title: c.title ?? (first ? titleFrom(first.text) : undefined),
      }
      imported += 1
    }
    this.meta.importedAccounts = [...(this.meta.importedAccounts ?? []), accountKey]
    await this.saveMeta()
    if (imported) {
      this.log(`imported ${imported} earlier conversation(s) read-only`)
      this.emit()
    }
    return imported
  }

  /**
   * Does this device have a support conversation? Reads only the encrypted meta store —
   * no client, no relay traffic (the app starts the client at launch only then).
   */
  static async hasConversation(scope: string = SUPPORT_SCOPE): Promise<boolean> {
    const meta = await new EncryptedKeyValueStore<Meta>(scope, "meta:")
      .getItem("meta")
      .catch(() => null)
    return Boolean(meta?.activeGroup)
  }

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
    if (item.type === "msg" && item.from !== this.pubkey && !this.screenFocused) {
      this.meta.unread = (this.meta.unread ?? 0) + 1
      this.saveMeta()
    }
    this.emit()
    await this.history.setItem(gid, this.items)
  }

  /**
   * F-M18-7: back in front after a background → reconnect + backfill, so a message
   * that woke us (push) or arrived meanwhile shows within seconds. Also when no close
   * was seen: after a while in the background Android drops sockets silently.
   */
  private onAppState(state: AppStateStatus) {
    if (state !== "active") {
      this.backgroundSince ??= Date.now()
      // M20: plaintext picture shadows live only while the app is in front
      wipeLiveImages()
      return
    }
    const away = this.backgroundSince === null ? 0 : Date.now() - this.backgroundSince
    this.backgroundSince = null
    if (this.destroyed || this.status === "starting" || !this.client) return
    // M20: the shadows wiped on background are (re)decrypted for the on-screen items
    ensureLiveImages(this.scope, this.viewing ? this.viewItems : this.items)
    if (this.closedInBackground || away > 20_000) {
      this.closedInBackground = false
      this.reInit(`foreground after ${Math.round(away / 1000)}s in background`, {
        counted: false,
      })
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    this.appStateSub?.remove()
    anomalyListeners.delete(this.onAnomaly)
    if (this.stuckTimer) clearTimeout(this.stuckTimer)
    this.stopStallWatcher()
    this.inviteWatch?.abort()
    this.conn?.unsubscribe()
    this.inviteListen?.unsubscribe()
    this.rosterSub?.unsubscribe()
    this.tokenRefreshSub?.()
    wipeLiveImages()
    if (this.group) await this.group.save(true).catch(() => undefined)
    await this.network?.destroy()
  }
}
