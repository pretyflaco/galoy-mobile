/**
 * M18 support-chat push: the token announcement the app sends into the conversation
 * (marmot-push-v1 kind 447) — encrypted to the configured server, owner-signed for the
 * exact group and leaf, verifiable by any member (the relay runs the same check), and
 * refused when the signer returns a different event.
 */
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure"
import {
  checkEntry,
  decryptToken,
  fromBase64,
} from "@blink-support-chat/adapters/push-mip05.js"

const SERVER_SK = generateSecretKey()
const SERVER_PK = getPublicKey(SERVER_SK)

jest.mock("react-native-config", () => ({ SUPPORT_PUSH_SERVER_PUBKEY: SERVER_PK }))
jest.mock("react-native-push-notification", () => ({
  createChannel: jest.fn(),
  localNotification: jest.fn(),
}))
jest.mock("@react-native-firebase/messaging", () => () => ({}))

// eslint-disable-next-line import/first
import {
  announcementKey,
  buildTokenAnnouncement,
  PUSH_SERVER_PUBKEY,
} from "@app/support-chat/push"

type Template = {
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

const userSk = generateSecretKey()
const user = getPublicKey(userSk)
const signer = { signEvent: async (t: Template) => finalizeEvent(t, userSk) }
const GROUP = "ab".repeat(32)
const token = { platform: "fcm" as const, token: "fcm:APA91b" + "z".repeat(150) }

describe("support-chat push announcement", () => {
  it("reads the server key from build config", () => {
    expect(PUSH_SERVER_PUBKEY).toBe(SERVER_PK)
  })

  it("builds a verifiable kind 447 whose token only the server can read", async () => {
    const rumor = await buildTokenAnnouncement({
      signer,
      pubkey: user,
      groupIdHex: GROUP,
      leafIndex: 0,
      token,
      relayHint: "wss://relay.twentyone.ist",
    })
    expect(rumor.kind).toBe(447)
    expect(rumor.pubkey).toBe(user)
    expect(rumor.tags).toEqual([["v", "marmot-push-v1"]])
    const [entry] = JSON.parse(rumor.content).tokens
    expect(checkEntry(entry, GROUP)).toBeNull()
    expect(checkEntry(entry, "cd".repeat(32))).toBe("owner_sig does not verify")
    const plain = decryptToken(fromBase64(entry.encrypted_token), SERVER_SK)
    expect(new TextDecoder().decode(plain.deviceToken)).toBe(token.token)
  })

  it("refuses a signer that returns a different event", async () => {
    const evil = {
      // eslint-disable-next-line camelcase
      signEvent: async (t: Template) => finalizeEvent({ ...t, created_at: 1 }, userSk),
    }
    await expect(
      buildTokenAnnouncement({
        signer: evil,
        pubkey: user,
        groupIdHex: GROUP,
        leafIndex: 0,
        token,
        relayHint: "wss://relay.twentyone.ist",
      }),
    ).rejects.toThrow("signer returned a different proof event")
  })

  it("announcement key changes with the token and the leaf", () => {
    const a = announcementKey(token, 0)
    expect(announcementKey(token, 1)).not.toBe(a)
    expect(announcementKey({ ...token, token: token.token + "x" }, 0)).not.toBe(a)
  })
})
