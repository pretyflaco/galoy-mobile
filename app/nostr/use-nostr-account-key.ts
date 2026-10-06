/**
 * React resolver for the signer's per-account scope key (see core/account-scope.ts).
 *
 *  - self-custodial account → the account-index entry id (persistentState.activeAccountId);
 *  - custodial account      → the selected session profile's backend `accountId`;
 *  - anything unresolved    → null (callers treat null as inert/gated).
 *
 * Deliberately NOT built on useAccountRegistry: NostrRuntimeProvider mounts ABOVE the
 * registry in the provider tree, so this hook composes the two lower-level sources both
 * available up there — persistent state + the session-profile store.
 */
import { useEffect, useState } from "react"

import { usePersistentStateContext } from "@app/store/persistent-state"
import { DefaultAccountId } from "@app/types/wallet"
import KeyStoreWrapper from "@app/utils/storage/secureStorage"

export interface NostrAccountScope {
  /** The scoping key, or null while/unless unresolvable. */
  accountKey: string | null
  /** False until the resolution has settled (session-profile read in flight). */
  ready: boolean
}

export interface NostrAccountMode {
  /** True when the ACTIVE account is a self-custodial (Spark) account. */
  isSelfCustodial: boolean
  /**
   * The self-custodial scope key when active (null otherwise). Deliberately NOT
   * use-active-wallet's `isSelfCustodial`, which conflates SDK availability with account type.
   */
  accountKey: string | null
}

export const useNostrAccountKey = (): NostrAccountScope => {
  const { persistentState } = usePersistentStateContext()
  const activeAccountId = persistentState?.activeAccountId
  const authToken = persistentState?.galoyAuthToken
  const [custodialAccountId, setCustodialAccountId] = useState<string | null>(null)
  const [profilesReady, setProfilesReady] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const isCustodial = !activeAccountId || activeAccountId === DefaultAccountId.Custodial

  // Reset the heal-retry counter whenever the account/token changes.
  useEffect(() => {
    setAttempt(0)
  }, [authToken, activeAccountId])

  // Custodial scope: the backend accountId of the active session profile (matched by the
  // live auth token, `selected` flag as fallback). Re-runs on account/token switches. The
  // accountId can be TRANSIENTLY missing right after account creation (the profile heals on
  // a later fetch) — so a null resolution retries briefly instead of parking the gate shut.
  useEffect(() => {
    if (!isCustodial) return
    let mounted = true
    let retry: ReturnType<typeof setTimeout> | undefined
    if (attempt === 0) setProfilesReady(false)
    KeyStoreWrapper.getSessionProfiles()
      .then((profiles) => {
        if (!mounted) return
        const active =
          profiles.find((p) => p.token === authToken) ?? profiles.find((p) => p.selected)
        const id = active?.accountId ?? null
        if (id === null && attempt < 5) {
          retry = setTimeout(() => setAttempt((a) => a + 1), 1000)
          return
        }
        setCustodialAccountId(id)
        setProfilesReady(true)
      })
      .catch(() => {
        if (!mounted) return
        setCustodialAccountId(null)
        setProfilesReady(true)
      })
    return () => {
      mounted = false
      if (retry) clearTimeout(retry)
    }
  }, [isCustodial, authToken, activeAccountId, attempt])

  if (!isCustodial) {
    // Self-custodial: the entry id IS the scope key, synchronously known.
    return { accountKey: activeAccountId ?? null, ready: true }
  }
  return { accountKey: custodialAccountId, ready: profilesReady }
}

/**
 * Custody-mode detection for wallet-facing nostr features (delegated grants, seed-derived
 * nsec). Uses the SAME predicate as useNostrAccountKey's custody split so mode and scope can
 * never disagree.
 */
export const useNostrAccountMode = (): NostrAccountMode => {
  const { persistentState } = usePersistentStateContext()
  const activeAccountId = persistentState?.activeAccountId
  const isSelfCustodial =
    Boolean(activeAccountId) && activeAccountId !== DefaultAccountId.Custodial
  return { isSelfCustodial, accountKey: isSelfCustodial ? activeAccountId ?? null : null }
}
