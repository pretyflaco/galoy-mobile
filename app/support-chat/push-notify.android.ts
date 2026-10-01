/**
 * Android: content-free local notification for a support-chat push wake (M18).
 * Platform file on purpose: react-native-push-notification's iOS entry needs
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
  })
}
