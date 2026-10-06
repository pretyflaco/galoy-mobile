/**
 * Local registry of created delegated grants, scoped per self-custodial account.
 *
 * Stores ONLY public material (delegated pubkey fingerprint, owner pubkey, address,
 * expiry) — never the DRGK private hex, which is shown once on the success screen and
 * lives solely in the user's LNbits instance afterwards (leak-audit AC-3). The server is
 * the source of truth; this list drives the POC delegation-list UI between sessions.
 */
import { scopedStorageKey } from "@app/nostr/core/account-scope"
import { loadJson, remove, saveJson } from "@app/utils/storage"

import type { GrantRecord } from "./grant-api"

const BASE_KEY = "selfcustodial.delegatedGrants"

const shortFingerprint = (compressedPubKeyHex: string): string =>
  compressedPubKeyHex.length >= 8 ? compressedPubKeyHex.slice(0, 8) : compressedPubKeyHex

export const grantFingerprint = shortFingerprint

export const loadGrants = async (accountKey: string | null): Promise<GrantRecord[]> => {
  const scoped = scopedStorageKey(BASE_KEY, accountKey)
  if (!scoped) return []
  const stored = (await loadJson(scoped)) as GrantRecord[] | null
  return Array.isArray(stored) ? stored : []
}

export const saveGrant = async (
  accountKey: string | null,
  record: GrantRecord,
): Promise<void> => {
  const scoped = scopedStorageKey(BASE_KEY, accountKey)
  // Null scope = inert (never a shared slot): dropping the local record is acceptable —
  // the server still holds the grant and revocation can be re-created by key rotation.
  if (!scoped) return
  const existing = await loadGrants(accountKey)
  await saveJson(scoped, [
    record,
    ...existing.filter((g) => g.delegatedPubkey !== record.delegatedPubkey),
  ])
}

export const removeGrant = async (
  accountKey: string | null,
  delegatedPubkey: string,
): Promise<void> => {
  const scoped = scopedStorageKey(BASE_KEY, accountKey)
  if (!scoped) return
  const existing = await loadGrants(accountKey)
  const next = existing.filter((g) => g.delegatedPubkey !== delegatedPubkey)
  if (next.length === 0) {
    await remove(scoped)
    return
  }
  await saveJson(scoped, next)
}
