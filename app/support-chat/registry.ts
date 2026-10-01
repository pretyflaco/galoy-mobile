/**
 * The running support-chat clients, one per account — kept in a module of its own
 * (type-only client import) so places that merely SHOW chat state (the Settings row's
 * unread count) do not pull the whole client chain (marmot-ts, crypto, push) into
 * their screen.
 */
import { useEffect, useReducer } from "react"

import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"

import type { SupportChatClient } from "./client"

export const supportChatClients = new Map<
  string,
  { client: SupportChatClient; ready: Promise<void> }
>()

/** The account's client IF it is running — never creates one (no relay traffic). */
export const useRunningSupportChat = (): SupportChatClient | null => {
  const nostr = useNostrRuntime()
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const accountKey = nostr?.accountReady ? nostr.accountKey : null
  const client = accountKey ? supportChatClients.get(accountKey)?.client ?? null : null
  useEffect(() => {
    if (!client) return undefined
    const unsubscribe = client.subscribe(rerender)
    return () => {
      unsubscribe()
    }
  }, [client])
  return client
}
