// CI smoke peer: the roster-listed "bot" — publishes discovery, joins the group
// the app creates (Welcome), auto-replies to every message with its own key.
// Self-contained in the fork (vendored adapters + the pinned marmot-ts); state is
// in-memory (single process per CI run). Usage: node peer.mjs <relay> <identity-json>
import { readFileSync } from "node:fs"
import {
  MarmotClient,
  createChatRumor,
  createApplicationMessageIntent,
  deserializeApplicationData,
} from "@internet-privacy/marmot-ts"
import { TestEventSigner } from "../../vendor/blink-support-chat-adapters/signer.js"
import { SimplePoolNetwork } from "../../vendor/blink-support-chat-adapters/network.js"
import { ensureDiscoverable, fetchKeyPackageEvent } from "../../vendor/blink-support-chat-adapters/key-package-publish.js"

const RELAY = process.argv[2] ?? "ws://127.0.0.1:7777"
const IDENTITY = process.argv[3] ?? "/tmp/support-chat-smoke-state/bot.json"
const NAME = process.env.PEER_NAME ?? "CI Smoke Bot"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ts = () => new Date().toISOString().slice(11, 19)

const { secretKey } = JSON.parse(readFileSync(IDENTITY, "utf8"))
const signer = new TestEventSigner(Uint8Array.from(secretKey))
console.log(`[${ts()}] ${NAME} ${signer.publicKey.slice(0, 12)}… on ${RELAY}`)

const inMemoryStore = () => {
  const map = new Map()
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => { map.set(k, v); return v },
    removeItem: async (k) => { map.delete(k) },
    clear: async () => map.clear(),
    keys: async () => [...map.keys()],
  }
}
const network = new SimplePoolNetwork({ signer, relays: [RELAY] })
const client = new MarmotClient({
  signer, network, clientId: "ci-smoke-peer",
  groupStateStore: inMemoryStore(),
  keyPackageStore: inMemoryStore(),
  inviteStore: inMemoryStore(),
  ingestStateStore: inMemoryStore(),
  removedMarkerStore: inMemoryStore(),
})

await ensureDiscoverable(client, network, { relays: [RELAY], signer })
console.log(`[${ts()}] discovery published (30443 + 10051/10050/10002)`)

// Every Welcome is joined (a retried drive starts a NEW conversation on a fresh app
// identity — the single-group peer ignored it, run 36837196029 attempt 2).
const joined = new Set()
const replies = new Set()

async function join(welcome) {
  const { group } = await client.joinGroupFromWelcome({ welcomeRumor: welcome })
  await client.invites.markAsRead(welcome.id)
  const gid = Buffer.from(group.groupData.nostrGroupId).toString("hex")
  if (joined.has(gid)) return
  joined.add(gid)
  console.log(`[${ts()}] joined group ${gid.slice(0, 12)}… from Welcome`)
  const send = (content) =>
    client.groups.send(group.id, createApplicationMessageIntent(createChatRumor({ pubkey: signer.publicKey, content })))
  // marmot-ts 0.6.0 binds the rumor author to the MLS sender before this fires (F-M9-3)
  group.on("applicationMessage", async (d) => {
    const rumor = deserializeApplicationData(d)
    if (rumor.pubkey === signer.publicKey || replies.has(rumor.id)) return
    replies.add(rumor.id)
    console.log(`[${ts()}] ${gid.slice(0, 8)} app says: "${rumor.content}"`)
    try {
      await send(`${NAME}: copy "${rumor.content.slice(0, 60)}"`)
      console.log(`[${ts()}] -> replied`)
    } catch (e) {
      console.log(`[${ts()}] reply failed: ${e.message}`)
    }
  })
  await client.groups.connect(group.id)
  await send(`${NAME} joined`)
}

for (;;) {
  const wraps = await network.request([RELAY], { kinds: [1059], "#p": [signer.publicKey] })
  if (wraps.length) {
    await client.invites.ingestEvents(wraps)
    await client.invites.decryptGiftWraps()
    for (const w of await client.invites.getUnread()) {
      try {
        await join(w)
      } catch (e) {
        console.log(`[${ts()}] join failed: ${e.message}`)
        await client.invites.markAsRead(w.id)
      }
    }
  }
  await sleep(2000)
}
