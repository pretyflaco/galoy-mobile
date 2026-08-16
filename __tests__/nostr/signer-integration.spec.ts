/**
 * Story A5 — end-to-end signer integration through the assembled runtime.
 *
 * Exercises the full assembled path with a mocked relay + in-memory storage (no socket, no
 * keychain), proving the pieces wired in A1–A4 work together:
 *
 *   nostrconnect:// (plugin URI) → ConnectFlow → approval → connect-ack + grant persisted
 *     → subsequent sign_event (kind 22242) is PRE-APPROVED by the connect-time grant (no second
 *       surface) and produces a valid BIP-340 signature verifiable against the user npub.
 *
 * This is the vertical the BTCPay POC round-trip depends on, asserted without a device.
 */
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "nostr-tools/pure"
import * as nip44 from "nostr-tools/nip44"
import * as nip19 from "nostr-tools/nip19"
import { bytesToHex } from "@noble/hashes/utils.js"
import { schnorr } from "@noble/curves/secp256k1.js"

import { createSignerRuntime } from "../../app/nostr/runtime"
import { NIP46_KIND } from "../../app/nostr/transport/nip46-codec"
import { __resetApprovalCoordinatorForTest } from "../../app/nostr/approval/coordinator"
import { __resetRelayPoolForTest } from "../../app/nostr/transport/relay-pool"

// -- the "user" identity (what the signer signs as) --
const userSk = generateSecretKey()
const userSkHex = bytesToHex(userSk)
const userPubHex = bytesToHex(schnorr.getPublicKey(userSk))
const userNpub = nip19.npubEncode(userPubHex)

// -- the device-local transport secret (AD-4), distinct from the identity --
const transportSk = generateSecretKey()
const transportSkHex = bytesToHex(transportSk)
const transportPubHex = bytesToHex(schnorr.getPublicKey(transportSk))

// -- the BTCPay plugin's ephemeral client identity --
const clientSk = generateSecretKey()
const clientPubkey = getPublicKey(clientSk)

const memoryStorage = () => {
  const map = new Map<string, unknown>()
  return {
    loadJson: async (k: string) => map.get(k) ?? null,
    saveJson: async (k: string, v: unknown) => {
      map.set(k, JSON.parse(JSON.stringify(v)))
    },
  }
}

// A fake relay pool capturing published (outbound) events.
const makeFakePool = () => {
  const published: { kind: number; content: string; pubkey: string }[] = []
  return {
    pool: {
      subscribe: () => ({ close: () => undefined }),
      publish: (_relays: string[], event: unknown) => {
        published.push(event as { kind: number; content: string; pubkey: string })
        return [Promise.resolve("ok")]
      },
      close: () => undefined,
      destroy: () => undefined,
    },
    published,
  }
}

// Build a signed, NIP-44-encrypted kind-24133 request from the client to the transport key,
// exactly as a NIP-46 signer client (the plugin's counterpart) would.
const makeRequestEvent = (method: string, params: string[], id: string) => {
  const convKey = nip44.getConversationKey(clientSk, transportPubHex)
  const content = nip44.encrypt(JSON.stringify({ id, method, params }), convKey)
  const evt = finalizeEvent(
    {
      kind: NIP46_KIND,
      // eslint-disable-next-line camelcase
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", transportPubHex]],
      content,
    },
    clientSk,
  )
  // Arrive as plain wire JSON (strip nostr-tools' verified cache so verify does a real check).
  return JSON.parse(JSON.stringify(evt))
}

const PLUGIN_URI =
  `nostrconnect://${clientPubkey}` +
  `?relay=wss://nos.lol&relay=wss://relay.primal.net` +
  `&secret=login-secret&perms=sign_event:22242&name=BTCPay%20Server`

beforeEach(() => {
  __resetApprovalCoordinatorForTest()
  __resetRelayPoolForTest()
})

describe("end-to-end signer integration (A5)", () => {
  it("connect → approve → grant persisted → sign_event(22242) pre-approved → valid signature", async () => {
    const fake = makeFakePool()
    let presentedKinds: string[] = []

    const runtime = createSignerRuntime({
      readNsecHex: async () => userSkHex,
      readTransportSkHex: async () => transportSkHex,
      storage: memoryStorage(),
      createPool: () => fake.pool,
      // Auto-approve the FIRST surface (the connection) so we can drive the flow headlessly.
      present: async () => {
        presentedKinds.push("surface")
        runtime.coordinator.resolveActive({ approved: true })
      },
    })

    // 1. The BTCPay plugin's nostrconnect:// URI arrives (deep-link/QR forwards it here).
    await runtime.handleConnectUri(PLUGIN_URI)

    // The connection raised exactly one approval surface and was approved.
    expect(presentedKinds).toEqual(["surface"])

    // 2. A sign_event for the kind-22242 auth challenge arrives over the (mocked) relay.
    presentedKinds = []
    const challenge = JSON.stringify({ kind: 22242, content: "", tags: [] })
    await runtime.handleInbound(makeRequestEvent("sign_event", [challenge], "req-signin"))

    // The connect-time grant (sign_event:22242) pre-approves it — NO second surface.
    expect(presentedKinds).toEqual([])

    // 3. A NIP-46 response (kind-24133) was published back, carrying the signed event as its
    //    encrypted `result`. Decrypt it and verify the inner signed kind-22242 event.
    const reply = fake.published.find((e) => e.kind === NIP46_KIND)
    expect(reply).toBeTruthy()
    const convKey = nip44.getConversationKey(clientSk, transportPubHex)
    const decoded = JSON.parse(
      nip44.decrypt((reply as { content: string }).content, convKey),
    )
    expect(decoded.id).toBe("req-signin")
    const signed = JSON.parse(decoded.result)
    expect(signed.kind).toBe(22242)
    expect(signed.pubkey).toBe(userPubHex)
    expect(verifyEvent(signed)).toBe(true)
    // It is the USER's signature (verifiable against the user npub).
    expect(nip19.decode(userNpub).data).toBe(signed.pubkey)
  })

  it("get_public_key returns the user npub over the transport (no approval surface)", async () => {
    const fake = makeFakePool()
    const runtime = createSignerRuntime({
      readNsecHex: async () => userSkHex,
      readTransportSkHex: async () => transportSkHex,
      storage: memoryStorage(),
      createPool: () => fake.pool,
      present: async () => runtime.coordinator.resolveActive({ approved: true }),
    })

    // Connect first (establishes the relay set responses are published to), then query.
    await runtime.handleConnectUri(PLUGIN_URI)
    await runtime.handleInbound(makeRequestEvent("get_public_key", [], "req-pk"))

    // A response event was published back (encrypted); its existence proves the transport path.
    expect(fake.published.length).toBeGreaterThan(0)
    const reply = fake.published.find((e) => e.kind === NIP46_KIND)
    expect(reply).toBeTruthy()
    // Decrypt the reply and confirm it carries the user npub.
    const convKey = nip44.getConversationKey(clientSk, transportPubHex)
    const decoded = JSON.parse(
      nip44.decrypt((reply as { content: string }).content, convKey),
    )
    expect(decoded.result).toBe(userNpub)
  })
})
