import { useEffect, useReducer, useState } from "react"
import { AppState } from "react-native"
import Toast from "react-native-toast-message"

import { requestInAppRoute } from "@app/navigation/navigation-container-wrapper"

import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"

import { SupportChatClient } from "./client"
import { supportChatClients as clients } from "./registry"
import { SUPPORT_SCOPE } from "./support-key"

// One client per device for the app's lifetime: leaving the screen keeps the subscription
// (messages keep arriving and are stored). M19: independent of accounts and identities.

/**
 * While the app is in front but the chat screen is not, a new message from support
 * shows a short toast that opens the chat (no push in the foreground — the live
 * connection delivers; the Settings row keeps the unread count).
 */
const toastOnNewMessages = (client: SupportChatClient): void => {
  let seen = client.unread
  client.subscribe(() => {
    const now = client.unread
    if (now > seen && AppState.currentState === "active") {
      Toast.show({
        type: "success",
        text1: "Blink Support",
        text2: "New message in your support chat — tap to open",
        position: "top",
        visibilityTime: 6000,
        onPress: () => {
          Toast.hide()
          requestInAppRoute("supportChat")
        },
      })
    }
    seen = now
  })
}

/**
 * The device's client (M19: one per device, on the device's own support key), created and
 * initialised on first use. With an account at hand, that account's conversations from
 * the Nostr-identity era are imported read-only once.
 */
export const ensureSupportChatClient = (
  legacyAccountKey?: string | null,
  onError?: (e: Error) => void,
): SupportChatClient => {
  let e = clients.get(SUPPORT_SCOPE)
  if (!e) {
    const client = new SupportChatClient()
    toastOnNewMessages(client)
    e = { client, ready: client.init() }
    clients.set(SUPPORT_SCOPE, e)
    e.ready.catch((err: Error) => {
      clients.delete(SUPPORT_SCOPE)
      onError?.(err)
    })
  }
  if (legacyAccountKey) {
    const { client } = e
    e.ready.then(() => client.importLegacy(legacyAccountKey)).catch(() => undefined)
  }
  return e.client
}

/** The chat screen: creates the client if needed. No account or Nostr identity required. */
export const useSupportChat = (): {
  client: SupportChatClient | null
  error: string | null
} => {
  const nostr = useNostrRuntime()
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const [error, setError] = useState<string | null>(null)
  const accountKey = nostr?.accountReady ? nostr.accountKey : null
  const entry = clients.get(SUPPORT_SCOPE)

  useEffect(() => {
    const client = ensureSupportChatClient(accountKey, (err) => setError(err.message))
    const unsubscribe = client.subscribe(rerender)
    rerender()
    return () => {
      unsubscribe()
    }
  }, [accountKey])

  return { client: entry?.client ?? null, error }
}
