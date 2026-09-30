import { useEffect, useReducer, useState } from "react"

import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"

import { SupportChatClient } from "./client"

// One client per account for the app's lifetime: leaving the screen keeps the subscription
// (messages keep arriving and are stored); an account switch gets its own client.
const clients = new Map<string, { client: SupportChatClient; ready: Promise<void> }>()

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
    let e = clients.get(accountKey)
    if (!e) {
      const client = new SupportChatClient(nostr.runtime, accountKey)
      e = { client, ready: client.init() }
      clients.set(accountKey, e)
      e.ready.catch((err: Error) => {
        clients.delete(accountKey)
        setError(err.message)
      })
    }
    const unsubscribe = e.client.subscribe(rerender)
    rerender()
    return () => {
      unsubscribe()
    }
  }, [nostr, accountKey])

  return { client: entry?.client ?? null, error }
}
