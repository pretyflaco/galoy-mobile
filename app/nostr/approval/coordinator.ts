/**
 * ApprovalCoordinator (Story 3.4 / AD-9 / AD-16) — the SINGLE owner of ALL approval surfacing.
 *
 * Connection approvals (from ConnectFlow, 3.3) AND request approvals (from the pipeline, 3.2)
 * flow into ONE strictly-serialized FIFO. Exactly one surface is presented at a time; entry
 * N+1 is presented only after N resolves (approve / reject / timeout / disconnect). Queue depth
 * is exposed to the UI. No other module raises an approval surface.
 *
 * Every request raises its own approval EXCEPT requests covered by the per-connection
 * connect-time grant (v1: only sign_event:22242) — those pass through pre-approved without a
 * surface. Approving N never approves N+1.
 *
 * Identity-mutation flows (ceremony completion / import commit) are EXCLUSIVE sections: the
 * coordinator PAUSES presentation while the mutation commits, and stamps the identity epoch at
 * approval so the executor can reject an approval made against a superseded identity
 * (approved-against-N never executes against N+1).
 *
 * AD-1: this module is UI-free. The actual surface is an injected `present` port (the RN
 * screen/coordinator hook, Task 3); `present` resolves when the human decides via
 * `resolveActive`. `isCoveredByGrant` reads the ConnectionStore grant (shared predicate).
 */

/** Client metadata carried on a connection-approval entry. */
export interface EntryMetadata {
  name?: string
  url?: string
  image?: string
}

/** A connection-approval entry (from ConnectFlow). */
export interface ConnectionApprovalEntry {
  id: string
  kind: "connection"
  clientPubkey: string
  metadata: EntryMetadata
}

/** A request-approval entry (from the pipeline). */
export interface RequestApprovalEntry {
  id: string
  kind: "request"
  clientPubkey: string
  /** NIP-46 method (sign_event, nip44_decrypt, …). */
  method: string
  /** For sign_event, the event kind (e.g. 22242 auth challenge). */
  eventKind?: number
  /** Human-meaning action for the surface + SR label (never raw scope/kind). */
  humanAction: string
  /** Human-readable content preview of what will be signed/decrypted. */
  contentPreview?: string
}

/** The FIFO carries both kinds through one queue. */
export type ApprovalEntry = ConnectionApprovalEntry | RequestApprovalEntry

/** The decision returned to the caller; carries the stamped identity epoch (AD-9). */
export interface ApprovalDecision {
  approved: boolean
  /** The identity epoch at the moment of approval (for execute-time re-check). */
  epoch?: number
}

export interface ApprovalCoordinatorPorts {
  /** Present a surface for `entry`; resolves (via resolveActive) when the human decides. */
  present: (entry: ApprovalEntry) => Promise<void>
  /** Whether the entry is covered by the connection's connect-time grant (pre-approved). */
  isCoveredByGrant?: (entry: ApprovalEntry) => Promise<boolean>
  /** The current identity epoch (stamped onto each approval). Defaults to 0. */
  currentEpoch?: () => number
}

interface QueueItem {
  entry: ApprovalEntry
  resolve: (decision: ApprovalDecision) => void
}

export interface ApprovalCoordinator {
  /** Enqueue an entry; resolves with the decision (pre-approved entries resolve immediately). */
  enqueue(entry: ApprovalEntry): Promise<ApprovalDecision>
  /** Resolve the currently-presented entry with the human's decision. */
  resolveActive(decision: { approved: boolean }): void
  /** Current queue depth (pending + active), exposed to the UI. */
  queueDepth(): number
  /** The entry currently presented, or null. */
  activeEntry(): ApprovalEntry | null
  /** Subscribe to queue changes (enqueue / resolve / pause); returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void
  /** Run `commit` as an exclusive section: presentation pauses until it resolves (AD-9). */
  runExclusive<T>(commit: () => Promise<T>): Promise<T>
  /** Whether a decision stamped at epoch N is still valid against `currentEpoch`. */
  isEpochValid(decision: ApprovalDecision, currentEpoch: number): boolean
}

/**
 * A no-op present port for the process-wide singleton created before the UI binds its real
 * `present`. The UI (coordinator hook, Task 3) replaces presentation by consuming this
 * coordinator; identity-mutation flows only need `runExclusive`, which never presents.
 */
const noopPresent = async (): Promise<void> => undefined

let singleton: ApprovalCoordinator | null = null

/**
 * The ONE process-wide ApprovalCoordinator (AD-9: single owner). Identity-mutation flows
 * (ceremony / import) drive its `runExclusive`; the pipeline and ConnectFlow route request /
 * connection approvals through it; the coordinator hook consumes it for presentation.
 */
export const getApprovalCoordinator = (): ApprovalCoordinator => {
  if (!singleton) singleton = createApprovalCoordinator({ present: noopPresent })
  return singleton
}

/** Test-only: drop the singleton so each test starts clean. */
export const __resetApprovalCoordinatorForTest = (): void => {
  singleton = null
}

export const createApprovalCoordinator = (
  ports: ApprovalCoordinatorPorts,
): ApprovalCoordinator => {
  const { present, isCoveredByGrant, currentEpoch } = ports
  const epochOf = (): number => currentEpoch?.() ?? 0

  const queue: QueueItem[] = []
  const listeners = new Set<() => void>()
  let active: QueueItem | null = null
  let paused = false

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const pump = (): void => {
    if (active || paused) return
    const next = queue.shift()
    if (!next) return
    active = next
    // Present asynchronously; the surface stays until resolveActive is called. The returned
    // promise is intentionally not awaited (presentation resolves via resolveActive).
    present(next.entry).catch(() => undefined)
    // Notify so the UI reflects the newly-presented active entry (post-drain).
    notify()
  }

  return {
    async enqueue(entry: ApprovalEntry): Promise<ApprovalDecision> {
      // Pre-approved by the fixed connect-time grant → no surface, resolve immediately.
      if (isCoveredByGrant && (await isCoveredByGrant(entry))) {
        return { approved: true, epoch: epochOf() }
      }
      return new Promise<ApprovalDecision>((resolve) => {
        queue.push({ entry, resolve })
        notify()
        pump()
      })
    },

    resolveActive(decision: { approved: boolean }): void {
      const current = active
      if (!current) return
      active = null
      // Stamp the identity epoch at the moment of approval (AD-9).
      current.resolve({ approved: decision.approved, epoch: epochOf() })
      notify()
      pump()
    },

    queueDepth(): number {
      return queue.length + (active ? 1 : 0)
    },

    activeEntry(): ApprovalEntry | null {
      return active?.entry ?? null
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async runExclusive<T>(commit: () => Promise<T>): Promise<T> {
      paused = true
      try {
        return await commit()
      } finally {
        paused = false
        pump()
        notify()
      }
    },

    isEpochValid(decision: ApprovalDecision, current: number): boolean {
      return decision.epoch === current
    },
  }
}
