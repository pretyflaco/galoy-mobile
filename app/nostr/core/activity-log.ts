/**
 * Per-client activity log (Amber-style "Show activity"), METADATA-ONLY.
 *
 * Records WHAT a connected client asked us to do and whether we accepted — never the content.
 * Each entry carries only: the method, the (optional) signed event kind, a wall-clock time, and
 * the accept/reject decision. It NEVER stores plaintext, ciphertext, params, previews, npubs of
 * counterparties, or any signable/decryptable payload. This is a hard leak-audit invariant (see
 * __tests__/nostr/leak-audit.spec.ts): the activity log is safe to persist and to render.
 *
 * Bounded ring per client (newest first, capped at ACTIVITY_RING_SIZE) so the log can never grow
 * unbounded on a chatty client. AD-1: core is UI-free. AD-17: persists as JSON via
 * app/utils/storage; the storage port is injected so it is unit-testable.
 */
import { loadJson, saveJson } from "@app/utils/storage"

/** AD-17 storage key. */
export const ACTIVITY_STORAGE_KEY = "nostr.activity.v1"

/** Max entries retained PER client (oldest evicted). */
export const ACTIVITY_RING_SIZE = 50

/** The narrow persistence port (injected; defaults to app/utils/storage). */
export interface ActivityStorage {
  loadJson: (key: string) => Promise<unknown>
  saveJson: (key: string, value: unknown) => Promise<void>
}

/** A single metadata-only activity entry. NO content/payload fields — ever. */
export interface ActivityEntry {
  /** NIP-46 method (sign_event, nip44_decrypt, …) or "connect". */
  method: string
  /** Signed event kind, when method === "sign_event" (e.g. 27235 for NIP-98). */
  eventKind?: number
  /** Unix milliseconds the decision was recorded. */
  time: number
  /** Whether we accepted (true) or rejected (false) the request. */
  accepted: boolean
}

/** Aggregate accept/reject counts for a client (activity screen stats card). */
export interface ActivityStats {
  total: number
  accepted: number
  rejected: number
}

export interface ActivityLog {
  /** Append a metadata-only entry for a client (ring-bounded, newest first). */
  record(clientPubkey: string, entry: ActivityEntry): Promise<void>
  /** Read a client's entries, newest first. */
  list(clientPubkey: string): Promise<ActivityEntry[]>
  /** Aggregate accept/reject stats for a client. */
  stats(clientPubkey: string): Promise<ActivityStats>
  /**
   * Subscribe to record events so a live screen (the Activity screen) can re-read after a new
   * entry lands — e.g. while the user watches, the connect / read-public-key / sign-in entries
   * are recorded in sequence. Returns an unsubscribe.
   */
  subscribe(listener: () => void): () => void
}

type ActivityMap = Record<string, ActivityEntry[]>

const defaultStorage: ActivityStorage = { loadJson, saveJson }

/**
 * Defensive projection: keep ONLY the four whitelisted metadata fields. Even if a caller passes
 * an object with extra keys, nothing but method/eventKind/time/accepted is ever persisted. This
 * is the belt to the leak-audit's suspenders.
 */
const sanitize = (entry: ActivityEntry): ActivityEntry => {
  const clean: ActivityEntry = {
    method: String(entry.method),
    time: Number(entry.time),
    accepted: Boolean(entry.accepted),
  }
  if (typeof entry.eventKind === "number") clean.eventKind = entry.eventKind
  return clean
}

export const createActivityLog = (
  storage: ActivityStorage = defaultStorage,
): ActivityLog => {
  const listeners = new Set<() => void>()
  const notify = (): void => listeners.forEach((l) => l())

  const readAll = async (): Promise<ActivityMap> => {
    const raw = (await storage.loadJson(ACTIVITY_STORAGE_KEY)) as ActivityMap | null
    return raw ?? {}
  }
  const writeAll = (map: ActivityMap): Promise<void> =>
    storage.saveJson(ACTIVITY_STORAGE_KEY, map)

  // Serialize ALL storage mutations through a single promise chain. `record` is a
  // read-modify-write over ONE shared key (all clients), and the runtime fires it
  // fire-and-forget for connect → get_public_key → decrypt in a burst. Without this mutex those
  // overlapping read-modify-writes interleave and later writes clobber earlier ones — silently
  // dropping entries (the "accepted decrypt missing from Activity" bug). The chain makes each
  // record atomic w.r.t. the others; a rejected op in the chain never breaks the next link.
  let writeChain: Promise<void> = Promise.resolve()
  const serialize = (task: () => Promise<void>): Promise<void> => {
    const run = writeChain.then(task, task)
    // Keep the chain alive regardless of this task's outcome (don't propagate rejections onward).
    writeChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    async record(clientPubkey, entry): Promise<void> {
      await serialize(async () => {
        const map = await readAll()
        const next = [sanitize(entry), ...(map[clientPubkey] ?? [])].slice(
          0,
          ACTIVITY_RING_SIZE,
        )
        map[clientPubkey] = next
        await writeAll(map)
        notify()
      })
    },

    async list(clientPubkey): Promise<ActivityEntry[]> {
      const map = await readAll()
      return map[clientPubkey] ?? []
    },

    async stats(clientPubkey): Promise<ActivityStats> {
      const entries = (await readAll())[clientPubkey] ?? []
      const accepted = entries.filter((e) => e.accepted).length
      return { total: entries.length, accepted, rejected: entries.length - accepted }
    },

    subscribe(listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
