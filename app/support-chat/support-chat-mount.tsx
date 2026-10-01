/**
 * App-level support-chat glue (M18, dogfood polish), mounted once beside the other app
 * mounts. Renders nothing.
 *  - a tap on the support-chat notification opens the chat, also from a cold start
 *    (requestInAppRoute: waits behind unlock + auth like any link, no app chooser);
 *  - if this account already has a conversation, the client starts at app launch —
 *    it catches up and shows unread messages without visiting the screen first. An
 *    account that never used support chat starts nothing (no relay traffic).
 */
import { useEffect } from "react"

import { useFeatureFlags } from "@app/config/feature-flags-context"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"
import { requestInAppRoute } from "@app/navigation/navigation-container-wrapper"

import { SupportChatClient } from "./client"
import { onWakeTap } from "./push-notify"
import { ensureSupportChatClient } from "./use-support-chat"

let tapRegistered = false

export const SupportChatMount = (): null => {
  const { supportChatEnabled } = useFeatureFlags()
  const nostr = useNostrRuntime()
  const accountKey = nostr?.accountReady ? nostr.accountKey : null

  useEffect(() => {
    if (!supportChatEnabled || tapRegistered) return
    tapRegistered = true
    // in-app navigation, not Linking.openURL: no app chooser with several Blink builds
    onWakeTap(() => requestInAppRoute("supportChat"))
  }, [supportChatEnabled])

  useEffect(() => {
    if (!supportChatEnabled || !nostr || !accountKey) return
    let cancelled = false
    SupportChatClient.hasConversation(accountKey).then((has) => {
      if (has && !cancelled) ensureSupportChatClient(nostr.runtime, accountKey)
    })
    return () => {
      cancelled = true
    }
  }, [supportChatEnabled, nostr, accountKey])

  return null
}
