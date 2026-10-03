/**
 * Android: content-free local notification for a support-chat push wake (M18), and its
 * tap. Platform file on purpose: react-native-push-notification's iOS entry needs
 * @react-native-community/push-notification-ios, which this app does not ship, and
 * Metro resolves every require at bundle time (iOS uses the APNs alert instead).
 */
import PushNotification from "react-native-push-notification"

const CHANNEL = "support-chat"
let channelReady = false

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
    userInfo: { supportChat: "1" }, // marks OUR notification for the tap handler
  })
}

type Tapped = { userInteraction?: boolean; data?: { supportChat?: string } }

/**
 * Call `onTap` when the user taps a support-chat notification — while the app runs, and
 * once for the notification that cold-started it. Returns nothing to undo: the library
 * holds one global handler (registered once per app run).
 */
export const onWakeTap = (onTap: () => void): void => {
  PushNotification.configure({
    requestPermissions: false, // the chat screen asks, where the user sees why
    popInitialNotification: true,
    onNotification: (n: Tapped) => {
      if (n?.userInteraction && n.data?.supportChat === "1") onTap()
    },
  })
}
