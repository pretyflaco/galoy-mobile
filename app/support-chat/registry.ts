/**
 * The running support-chat client (M19: one per device, keyed by its scope) — kept in a module of its own
 * (type-only client import) so places that merely SHOW chat state (the Settings row's
 * unread count) do not pull the whole client chain (marmot-ts, crypto, push) into
 * their screen.
 */
import { useEffect, useReducer } from "react"

import type { SupportChatClient } from "./client"

export const supportChatClients = new Map<
  string,
  { client: SupportChatClient; ready: Promise<void> }
>()

/** The device's client IF it is running — never creates one (no relay traffic). */
export const useRunningSupportChat = (): SupportChatClient | null => {
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const client = supportChatClients.get("device")?.client ?? null // SUPPORT_SCOPE (support-key.ts; not imported: keeps crypto out of this module)
  useEffect(() => {
    if (!client) return undefined
    const unsubscribe = client.subscribe(rerender)
    return () => {
      unsubscribe()
    }
  }, [client])
  return client
}
