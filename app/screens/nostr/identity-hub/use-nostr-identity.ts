import { useCallback, useEffect, useState } from "react"

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { schnorr } from "@noble/curves/secp256k1.js"
import * as nip19 from "nostr-tools/nip19"

import { nostrNsecService } from "@app/nostr/core/account-scope"
import { readSecret } from "@app/nostr/core/keystore"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"

/**
 * Read-only identity presence for the Nostr Identity hub (Story A2), account-scoped
 * (2026-08-20): reads the ACTIVE account's nsec (keychain service `nostr.nsec.<accountKey>`)
 * and derives ONLY the public npub for display — the nsec itself never leaves this read and
 * is never returned. Loading resolves to `{ npub }` when the account has an identity, or
 * `{ npub: null }` when it has none (empty-state). While the account scope is unresolvable
 * (custodial accountId not yet known), the hook reports `accountReady: false` so the hub can
 * GATE identity creation instead of writing to a fallback slot.
 *
 * The derivation mirrors the import hook (schnorr x-only pubkey → nip19 npub). This hook does
 * NOT interpret or sign; it only decides empty-vs-summary and shows the public address.
 */
export interface NostrIdentityState {
  loading: boolean
  npub: string | null
  /** The identity's x-only pubkey (hex) — drives the identicon; null in empty-state. */
  pubkeyHex: string | null
  /** False while the account scope is unresolvable — identity creation must stay gated. */
  accountReady: boolean
}

export const useNostrIdentity = (): NostrIdentityState & { reload: () => void } => {
  // The ONE shared scope resolution lives in the NostrRuntimeProvider context — never
  // resolve independently here (inter-instance skew caused the 2026-08-20 sign-in loop).
  const nostr = useNostrRuntime()
  const accountKey = nostr?.accountKey ?? null
  const scopeReady = nostr?.accountReady ?? false
  const [state, setState] = useState<Omit<NostrIdentityState, "accountReady">>({
    loading: true,
    npub: null,
    pubkeyHex: null,
  })

  const load = useCallback(async () => {
    setState({ loading: true, npub: null, pubkeyHex: null })
    if (!accountKey) {
      setState({ loading: false, npub: null, pubkeyHex: null })
      return
    }
    const nsecHex = await readSecret(nostrNsecService(accountKey))
    if (!nsecHex) {
      setState({ loading: false, npub: null, pubkeyHex: null })
      return
    }
    const pubkeyHex = bytesToHex(schnorr.getPublicKey(hexToBytes(nsecHex)))
    const npub = nip19.npubEncode(pubkeyHex)
    setState({ loading: false, npub, pubkeyHex })
  }, [accountKey])

  useEffect(() => {
    load().catch(() => setState({ loading: false, npub: null, pubkeyHex: null }))
  }, [load])

  const reload = useCallback(() => {
    load().catch(() => setState({ loading: false, npub: null, pubkeyHex: null }))
  }, [load])

  return { ...state, accountReady: scopeReady, reload }
}
