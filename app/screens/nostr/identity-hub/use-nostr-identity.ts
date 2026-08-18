import { useCallback, useEffect, useState } from "react"

import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { schnorr } from "@noble/curves/secp256k1.js"
import * as nip19 from "nostr-tools/nip19"

import { NOSTR_NSEC_SERVICE, readSecret } from "@app/nostr/core/keystore"

/**
 * Read-only identity presence for the Nostr Identity hub (Story A2). Reads the nsec from the
 * keystore and derives ONLY the public npub for display — the nsec itself never leaves this
 * read and is never returned. Loading resolves to `{ npub }` when an identity exists, or
 * `{ npub: null }` when the account has none (empty-state).
 *
 * The derivation mirrors the import hook (schnorr x-only pubkey → nip19 npub). This hook does
 * NOT interpret or sign; it only decides empty-vs-summary and shows the public address.
 */
export interface NostrIdentityState {
  loading: boolean
  npub: string | null
  /** The identity's x-only pubkey (hex) — drives the identicon; null in empty-state. */
  pubkeyHex: string | null
}

export const useNostrIdentity = (): NostrIdentityState & { reload: () => void } => {
  const [state, setState] = useState<NostrIdentityState>({
    loading: true,
    npub: null,
    pubkeyHex: null,
  })

  const load = useCallback(async () => {
    setState({ loading: true, npub: null, pubkeyHex: null })
    const nsecHex = await readSecret(NOSTR_NSEC_SERVICE)
    if (!nsecHex) {
      setState({ loading: false, npub: null, pubkeyHex: null })
      return
    }
    const pubkeyHex = bytesToHex(schnorr.getPublicKey(hexToBytes(nsecHex)))
    const npub = nip19.npubEncode(pubkeyHex)
    setState({ loading: false, npub, pubkeyHex })
  }, [])

  useEffect(() => {
    load().catch(() =>
      setState({ loading: false, npub: null, pubkeyHex: null }),
    )
  }, [load])

  const reload = useCallback(() => {
    load().catch(() => setState({ loading: false, npub: null, pubkeyHex: null }))
  }, [load])

  return { ...state, reload }
}
