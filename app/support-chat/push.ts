/**
 * Support-chat push (M18): Marmot's push standard ("marmot-push-v1", the MIP-05
 * successor) with Transponder as the notification server.
 *
 * - The device's native token (FCM on Android; APNs on iOS — the standard forbids FCM
 *   as an iOS proxy) is encrypted to Transponder's key and announced INSIDE the MLS
 *   group (kind 447, signed by our own key through the first-party signer seam). The
 *   relay never sees the token; Transponder never sees the group.
 * - When the relay sends us a message it wakes Transponder, which sends a silent,
 *   content-free push. We then show our own content-free notification: no plaintext
 *   ever passes through Google or Apple.
 *
 * Off unless the build sets SUPPORT_PUSH_SERVER_PUBKEY (the CI smoke does not: no real
 * Firebase there, and no permission dialog in the drive).
 */
// eslint-disable-next-line react-native/split-platform-components
import { PermissionsAndroid, Platform } from "react-native"
import Config from "react-native-config"
import messaging from "@react-native-firebase/messaging"
import PushNotification from "react-native-push-notification"

import {
  acceptSignedProof,
  encryptToken,
  ownerProofTemplate,
  toBase64,
  tokenFingerprint,
  tokenUpdateRumor,
} from "@blink-support-chat/adapters/push-mip05.js"

const configured = Config?.SUPPORT_PUSH_SERVER_PUBKEY
export const PUSH_SERVER_PUBKEY: string =
  typeof configured === "string" && /^[0-9a-f]{64}$/.test(configured) ? configured : ""

export type PushToken = { platform: "fcm" | "apns"; token: string }

type EventTemplate = {
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}
type Signer = { signEvent: (t: EventTemplate) => Promise<unknown> }
type Rumor = {
  id: string
  kind: number
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

/** Permission already granted? (Never prompts — the screen asks, see askPermission.) */
export const hasPermission = async (): Promise<boolean> => {
  if (Platform.OS === "android") {
    if (Number(Platform.Version) < 33) return true
    return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
  }
  const status = await messaging().hasPermission()
  return (
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL
  )
}

/** Ask once, from the chat screen (the moment a user can see why). */
export const askPermission = async (): Promise<boolean> => {
  if (!PUSH_SERVER_PUBKEY) return false
  if (Platform.OS === "android") {
    if (Number(Platform.Version) < 33) return true
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    )
    return res === PermissionsAndroid.RESULTS.GRANTED
  }
  const status = await messaging().requestPermission()
  return (
    status === messaging.AuthorizationStatus.AUTHORIZED ||
    status === messaging.AuthorizationStatus.PROVISIONAL
  )
}

/** The native platform token, or null (not configured / not permitted / unavailable). */
export const getPushToken = async (): Promise<PushToken | null> => {
  if (!PUSH_SERVER_PUBKEY || !(await hasPermission())) return null
  if (Platform.OS === "android") {
    const token = await messaging().getToken()
    return token ? { platform: "fcm", token } : null
  }
  await messaging().registerDeviceForRemoteMessages()
  const apns = await messaging().getAPNSToken()
  return apns ? { platform: "apns", token: apns.toLowerCase() } : null
}

/** Stable key for "this token is announced in this group from this leaf". */
export const announcementKey = (t: PushToken, leafIndex: number): string =>
  `${tokenFingerprint(t.platform, t.token)}:${leafIndex}:${PUSH_SERVER_PUBKEY}`

/**
 * The kind 447 self-update: our token, encrypted to Transponder, owner-signed for this
 * group and leaf. The signer's result is validated before its signature is used.
 */
export const buildTokenAnnouncement = async (o: {
  signer: Signer
  pubkey: string
  groupIdHex: string
  leafIndex: number
  token: PushToken
  relayHint: string
}): Promise<Rumor> => {
  // wire field names are fixed by the spec (snake_case)
  /* eslint-disable camelcase */
  const entry: Record<string, unknown> = {
    member_id_hex: o.pubkey,
    leaf_index: o.leafIndex,
    platform: o.token.platform,
    token_fingerprint: tokenFingerprint(o.token.platform, o.token.token),
    server_pubkey_hex: PUSH_SERVER_PUBKEY,
    relay_hint: o.relayHint,
    encrypted_token: toBase64(
      encryptToken({
        platform: o.token.platform,
        token: o.token.token,
        serverPubkeyHex: PUSH_SERVER_PUBKEY,
      }),
    ),
    owner_ts: Date.now(),
  }
  const template = ownerProofTemplate(entry, o.groupIdHex)
  const sig = acceptSignedProof(await o.signer.signEvent({ ...template }), template)
  return tokenUpdateRumor({ pubkey: o.pubkey, entries: [{ ...entry, owner_sig: sig }] })
  /* eslint-enable camelcase */
}

const CHANNEL = "support-chat"
let channelReady = false
/** Content-free local notification for a push wake (Android). */
export const showWakeNotification = (): void => {
  if (!channelReady) {
    PushNotification.createChannel(
      { channelId: CHANNEL, channelName: "Support chat", importance: 4 },
      () => undefined,
    )
    channelReady = true
  }
  PushNotification.localNotification({
    channelId: CHANNEL,
    title: "Blink Support",
    message: "You have a new message in your support chat.",
    tag: CHANNEL, // one notification, replaced, not a pile
  })
}

/**
 * Register the background wake handler (index.js, before the app mounts). Transponder's
 * FCM message is data-only: { content_available: "true" }.
 */
export const registerPushBackgroundHandler = (): void => {
  if (!PUSH_SERVER_PUBKEY || Platform.OS !== "android") return
  messaging().setBackgroundMessageHandler(async (message) => {
    if (message?.data?.content_available === "true") showWakeNotification()
  })
}
