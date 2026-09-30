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
import { ensureDiscoverable, fetchKeyPackageEvent } from "@blink-support-chat/adapters/key-package-publish.js"

import type { SignerRuntime } from "@app/nostr/runtime"
import { ensureUrlCanParse } from "@app/polyfills/url-can-parse"

// TEMP M12 debug (F-M12-2): surface the library's internal logger — the connect
// drain swallows ingest exceptions into it ("connect: ingest failed …").
import debug from "debug"
debug.enable("marmot-ts:*")

import { SUPPORT_ROSTER_PUBKEY, ROSTER_SNAPSHOT } from "./roster-config"
import { createBlinkEventSigner } from "./blink-signer"
import { EncryptedKeyValueStore } from "./encrypted-store"

/** Staging relay of the POC (wok, NIP-42 AUTH for gift wraps). */
export const SUPPORT_CHAT_RELAYS = ["wss://relay.twentyone.ist"]
const MAX_ITEMS = 500

export type ChatItem = {
  id: string
  at: number
  type: "msg" | "notice" | "warning"
  from?: string // authenticated sender (hex) for msg items — MLS-bound on v2 (F-M9-3)
  mine?: boolean
  text: string
}

export type MemberLabel = { pubkey: string; text: string; verified: boolean }

type Meta = { activeGroup?: string }
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
  // F-M12-2 stall detection: the engine can go silently dead (nondeterministic
  // processMessage failure on Hermes) while transport keeps delivering. The proven
  // recovery is a client re-init (fresh engine state re-ingests everything).
  private engineActivityAt = Date.now()
  private stallWatch: ReturnType<typeof setInterval> | null = null
  private reInits = 0
  private reIniting = false

  constructor(
    private readonly runtime: SignerRuntime,
    private readonly accountKey: string,
  ) {
    this.metaStore = new EncryptedKeyValueStore<Meta>(accountKey, "meta:")
    this.history = new EncryptedKeyValueStore<ChatItem[]>(accountKey, "history:")
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
        void this.reInit(`stall: engine silent ${Math.round(engineIdleMs / 1000)}s while transport delivering`)
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
            ["ingest_entry", "ingest_outcome", "ingest_error", "epoch_confirmed", "epoch_rolled_back", "epoch_state_changed"].includes(e?.type)
          )
            console.log(`[support-chat-audit] ${e.type} ${JSON.stringify(e).slice(0, 260)}`)
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
          new EncryptedKeyValueStore<RosterPersisted>(
            this.accountKey,
            "roster:",
          ).getItem("state"),
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
      this.push({
        id: `removed-${hex(gid)}`,
        at: now(),
        type: "warning",
        text: "You were removed from this chat",
      })
      if (this.group && hex(gid) === this.groupId) this.group = null
    })
    this.client.groups.on(
      "unreadable",
      (_gid: Uint8Array, event: { id: string }) => {
        this.noteEngineActivity()
        this.log(`inbound ${short(event.id)} unreadable (dropped by connect())`)
      },
    )
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
      this.items =
        (await this.history.getItem(this.meta.activeGroup as string)) ?? []
      this.log(
        `reloaded group ${short(this.groupId ?? "")} at epoch ${active.state.groupContext.epoch}, ${this.items.length} items (${Date.now() - t0}ms)`,
      )
    } else if (this.meta.activeGroup) {
      // The conversation's MLS state is gone or unreadable; its stored history is not.
      const old = this.meta.activeGroup
      this.items = [
        ...((await this.history.getItem(old)) ?? []),
        {
          id: `lost-${old}`,
          at: now(),
          type: "warning",
          text: "This conversation could not be restored after an app update (its encryption state is from an older library version). Earlier messages are shown read-only; start a new chat to continue.",
        },
      ]
      this.log(`active group ${short(old)} not restorable`)
      this.meta.activeGroup = undefined
      await this.metaStore.setItem("meta", this.meta)
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
    return {
      pubkey,
      text: this.roster.display(pubkey),
      verified: this.roster.label(pubkey).verified,
    }
  }

  members(): MemberLabel[] {
    if (!this.group) return []
    return getGroupMembers(this.group.state)
      .filter((pk: string) => pk !== this.pubkey)
      .map((pk: string) => this.label(pk))
  }

  /** Start a conversation with the support bot named on the roster. */
  async start(): Promise<void> {
    if (this.group) return
    if (this.roster.status() !== "valid")
      throw new Error(
        `no valid Blink Support roster (${this.roster.status()}) — not starting`,
      )
    const bots = [...this.roster.current.members].filter(
      ([, m]: any) => m.role === "bot",
    )
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
  }

  async send(text: string): Promise<void> {
    const group = this.group
    if (!group || !text.trim()) return
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
    this.group = group
    const gid = hex(group.groupData.nostrGroupId)
    this.groupId = gid
    group.on("stateChanged", (state: { groupContext: { epoch: bigint } }) => {
      this.noteEngineActivity()
      // TEMP M12 debug (F-M12-2): epoch visibility on device
      console.log(`[support-chat] ${gid.slice(0, 8)} epoch ${state.groupContext.epoch}`)
    })
    group.on("applicationMessage", (data: Uint8Array) => {
      this.noteEngineActivity()
      // v2: the engine already bound the rumor's author to the MLS sender leaf
      // (F-M9-3) — anything delivered here is authenticated to its sender.
      try {
        const rumor = deserializeApplicationData(data)
        if (rumor.pubkey === this.pubkey) return
        this.push({
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
    if (this.meta.activeGroup !== gid) {
      this.meta.activeGroup = gid
      void this.metaStore.setItem("meta", this.meta)
    }
    this.emit()
  }

  private async push(item: ChatItem) {
    if (this.items.some((x) => x.id === item.id)) return
    this.items = [...this.items, item].slice(-MAX_ITEMS)
    this.emit()
    if (this.groupId) await this.history.setItem(this.groupId, this.items)
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    this.stopStallWatcher()
    this.inviteWatch?.abort()
    this.conn?.unsubscribe()
    this.inviteListen?.unsubscribe()
    this.rosterSub?.unsubscribe()
    if (this.group) await this.group.save(true).catch(() => undefined)
    await this.network?.destroy()
  }
}
