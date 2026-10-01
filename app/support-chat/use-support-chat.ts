import { useEffect, useReducer, useState } from "react"
import { AppState } from "react-native"
import Toast from "react-native-toast-message"

import { requestInAppRoute } from "@app/navigation/navigation-container-wrapper"

import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"
import type { SignerRuntime } from "@app/nostr/runtime"

import { SupportChatClient } from "./client"
import { supportChatClients as clients } from "./registry"

// One client per account for the app's lifetime: leaving the screen keeps the subscription
// (messages keep arriving and are stored); an account switch gets its own client.

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

/** The account's client, created and initialised on first use. */
export const ensureSupportChatClient = (
  runtime: SignerRuntime,
  accountKey: string,
  onError?: (e: Error) => void,
): SupportChatClient => {
  let e = clients.get(accountKey)
  if (!e) {
    const client = new SupportChatClient(runtime, accountKey)
    toastOnNewMessages(client)
    e = { client, ready: client.init() }
    clients.set(accountKey, e)
    e.ready.catch((err: Error) => {
      clients.delete(accountKey)
      onError?.(err)
    })
  }
  return e.client
}

/** The chat screen: creates the client if needed. */
export const useSupportChat = (): {
  client: SupportChatClient | null
  error: string | null
} => {
  const nostr = useNostrRuntime()
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const [error, setError] = useState<string | null>(null)
  const accountKey = nostr?.accountReady ? nostr.accountKey : null
  const entry = accountKey ? clients.get(accountKey) : undefined

  useEffect(() => {
    if (!nostr || !accountKey) return
    const client = ensureSupportChatClient(nostr.runtime, accountKey, (err) =>
      setError(err.message),
    )
    const unsubscribe = client.subscribe(rerender)
    rerender()
    return () => {
      unsubscribe()
    }
  }, [nostr, accountKey])

  return { client: entry?.client ?? null, error }
}
