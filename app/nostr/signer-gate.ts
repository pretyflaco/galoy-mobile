/**
 * Feature-flag gating seam for the signer (Story 1.4 / AD-13 / NFR-9).
 *
 * The ENTIRE signer sits behind one remote flag (nostrSignerEnabled, owned by
 * app/nostr/config.ts, wired into app/config/feature-flags-context.tsx). This adapter is
 * the single boundary the signer entry points plug into:
 *
 *  - flag OFF  ⇒ signer invisible + inert: entry points deactivated, relay subscriptions
 *                closed, NO watcher registration (v1 no-op). ConnectionStore records are
 *                RETAINED (never cleared/tombstoned) so a later flag-on resumes them.
 *  - flag ON   ⇒ on the next signer init, entry points activate and retained connection
 *                records resume (relays re-open for them) with no fresh pairing.
 *
 * Gating lives at the adapter layer (AD-1) — app/nostr/core/** stays flag-agnostic. This
 * seam references only signer surfaces; it never touches wallet flows (NFR-9).
 *
 * AD-14 v1: there is no watcher to register/unregister (nostr-signer-push is deferred
 * post-v1, foreground-only). The AD-13 "watcher unregistered" clause is a no-op here and
 * re-applies only when Pattern-B / push lands.
 */

/** A retained connection record (full shape owned by ConnectionStore, AD-8, Epic 3). */
export interface ConnectionRecordLike {
  clientPubkey: string
  relays: string[]
}

/** The signer surfaces the gate controls. Deliberately signer-only — no wallet surface. */
export interface SignerGateDeps {
  connectionStore: {
    list(): ConnectionRecordLike[]
    /** Present on the real store; the gate must NEVER call it on flag toggle. */
    clear?: () => void
  }
  relayPool: {
    openForConnections(records: ConnectionRecordLike[]): void
    closeAll(): void
  }
  entryPoints: {
    activate(): void
    deactivate(): void
  }
}

/**
 * Apply the flag at signer initialization. Idempotent per init; call on each signer init
 * (aligned to the remote-config read cadence / remoteConfigReady).
 */
export const initSignerGate = (enabled: boolean, deps: SignerGateDeps): void => {
  if (!enabled) {
    // Invisible + inert. Records are RETAINED — do not clear/tombstone.
    deps.entryPoints.deactivate()
    deps.relayPool.closeAll()
    // AD-14 v1: watcher unregister is a no-op (nothing registered); re-applies when Pattern-B lands.
    return
  }

  // Flag ON: activate entry points and resume retained connections (no fresh pairing).
  deps.entryPoints.activate()
  deps.relayPool.openForConnections(deps.connectionStore.list())
}
