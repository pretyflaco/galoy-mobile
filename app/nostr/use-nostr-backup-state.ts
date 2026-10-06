import { useCallback, useEffect, useState } from "react"

import { loadString } from "@app/utils/storage/storage"

import { nostrBackupDoneKey, nostrNsecService } from "@app/nostr/core/account-scope"
import { readSecret } from "@app/nostr/core/keystore"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"

export type NostrBackupState = {
  loading: boolean
  /** True when the active account has a Nostr identity (an nsec in the keystore). */
  hasIdentity: boolean
  /**
   * True when the identity is covered by a backup: an explicit backup-method marker
   * (cloud / keychain / manual) OR the "wallet-seed" marker written at creation for
   * NIP-06-derived keys (the wallet backup phrase covers them — spec §8).
   */
  backedUp: boolean
  /** Re-read both sources (call on screen focus — backup completion writes the marker). */
  reload: () => void
}

/**
 * Read-only view of the per-account "identity backed up" flag, driving the Hub banner
 * and the Blink Home security alert (spec §7.5 / §7.14). The marker lives in AsyncStorage
 * (`nostr.backupDone.<accountKey>`); the nsec itself stays in the keychain and is only
 * probed for presence here — never read out.
 */
export const useNostrBackupState = (): NostrBackupState => {
  const nostr = useNostrRuntime()
  const accountKey = nostr?.accountKey ?? null
  const [state, setState] = useState({
    loading: true,
    hasIdentity: false,
    backedUp: false,
  })

  const load = useCallback(async () => {
    if (!accountKey) {
      setState({ loading: false, hasIdentity: false, backedUp: false })
      return
    }
    const [nsecHex, marker] = await Promise.all([
      readSecret(nostrNsecService(accountKey)),
      loadString(nostrBackupDoneKey(accountKey)),
    ])
    setState({
      loading: false,
      hasIdentity: Boolean(nsecHex),
      backedUp: Boolean(marker),
    })
  }, [accountKey])

  useEffect(() => {
    load().catch(() => setState({ loading: false, hasIdentity: false, backedUp: false }))
  }, [load])

  const reload = useCallback(() => {
    load().catch(() => undefined)
  }, [load])

  return { ...state, reload }
}
