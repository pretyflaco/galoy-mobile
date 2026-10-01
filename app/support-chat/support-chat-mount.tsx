/**
 * App-level support-chat glue (M18, dogfood polish), mounted once beside the other app
 * mounts. Renders nothing.
 *  - a tap on the support-chat notification opens the chat, also from a cold start
 *    (through the app's deep-link config, so it waits behind unlock like any link);
 *  - if this account already has a conversation, the client starts at app launch —
 *    it catches up and shows unread messages without visiting the screen first. An
 *    account that never used support chat starts nothing (no relay traffic).
 */
import { useEffect } from "react"
import { Linking } from "react-native"

import { useFeatureFlags } from "@app/config/feature-flags-context"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"

import { SupportChatClient } from "./client"
import { onWakeTap } from "./push-notify"
import { ensureSupportChatClient } from "./use-support-chat"

export const SUPPORT_CHAT_LINK = "blink://support-chat"

let tapRegistered = false

export const SupportChatMount = (): null => {
  const { supportChatEnabled } = useFeatureFlags()
  const nostr = useNostrRuntime()
  const accountKey = nostr?.accountReady ? nostr.accountKey : null

  useEffect(() => {
    if (!supportChatEnabled || tapRegistered) return
    tapRegistered = true
    onWakeTap(() => {
      Linking.openURL(SUPPORT_CHAT_LINK).catch(() => undefined)
    })
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
