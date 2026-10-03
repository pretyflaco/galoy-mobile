/**
 * Duplicate-connection prompt store (fix #4).
 *
 * A re-login by an already-connected app mints a fresh ephemeral clientPubkey, so the connection
 * store would accrete a new row every sign-in. When ConnectFlow detects an existing record for
 * the same IDENTITY (metadata.url ?? metadata.name), it asks the human how to resolve it:
 * Replace (drop the old), Keep both, or Cancel.
 *
 * The coordinator's approval decision is deliberately BINARY (approve/reject), so this 3-way
 * choice lives OUTSIDE the coordinator queue: a tiny promise-backed observable the runtime binds
 * to ConnectFlow's `resolveDuplicate` port and the ApprovalSurfaceHost renders as its own
 * overlay. AD-1: this is UI-free state; the screen is pure presentation.
 */
import type {
  DuplicateConnectionRequest,
  DuplicateResolution,
} from "@app/nostr/transport/connect-flow"

export interface DuplicatePromptState {
  request: DuplicateConnectionRequest
  resolve: (resolution: DuplicateResolution) => void
}

export interface DuplicatePromptStore {
  /** Present the prompt and await the human's Replace/Keep/Cancel choice. */
  prompt(request: DuplicateConnectionRequest): Promise<DuplicateResolution>
  /** The active prompt, or null when nothing is pending. */
  current(): DuplicatePromptState | null
  /** Subscribe to changes; returns an unsubscribe. */
  subscribe(listener: () => void): () => void
}

export const createDuplicatePromptStore = (): DuplicatePromptStore => {
  let active: DuplicatePromptState | null = null
  const listeners = new Set<() => void>()
  const notify = (): void => listeners.forEach((l) => l())

  return {
    prompt(request): Promise<DuplicateResolution> {
      return new Promise<DuplicateResolution>((resolve) => {
        active = {
          request,
          resolve: (resolution) => {
            // Resolve once, then clear + notify so the overlay hides.
            active = null
            notify()
            resolve(resolution)
          },
        }
        notify()
      })
    },
    current: () => active,
    subscribe(listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
