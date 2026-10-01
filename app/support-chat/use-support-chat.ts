import { useEffect, useReducer, useState } from "react"

import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"
import type { SignerRuntime } from "@app/nostr/runtime"

import { SupportChatClient } from "./client"

// One client per account for the app's lifetime: leaving the screen keeps the subscription
// (messages keep arriving and are stored); an account switch gets its own client.
const clients = new Map<string, { client: SupportChatClient; ready: Promise<void> }>()

/** The account's client, created and initialised on first use. */
export const ensureSupportChatClient = (
  runtime: SignerRuntime,
  accountKey: string,
  onError?: (e: Error) => void,
): SupportChatClient => {
  let e = clients.get(accountKey)
  if (!e) {
    const client = new SupportChatClient(runtime, accountKey)
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

/**
 * Elsewhere in the app (settings row badge): the account's client IF it is running —
 * never creates one, so merely showing settings starts no relay traffic.
 */
export const useRunningSupportChat = (): SupportChatClient | null => {
  const nostr = useNostrRuntime()
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const accountKey = nostr?.accountReady ? nostr.accountKey : null
  const client = accountKey ? clients.get(accountKey)?.client ?? null : null
  useEffect(() => {
    if (!client) return undefined
    const unsubscribe = client.subscribe(rerender)
    return () => {
      unsubscribe()
    }
  }, [client])
  return client
}
