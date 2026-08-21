/**
 * Secret confinement for the signer (Story 1.3 / AD-7 / FR-7).
 *
 * A thin wrapper over react-native-keychain's generic-password store, namespaced by
 * `service`, using the same AFTER_FIRST_UNLOCK credential pattern the app already uses
 * for credential backup. Secrets are unreadable before first device unlock.
 *
 * This module is generic (it stores opaque hex secrets by service name); it does NOT
 * interpret any secret as an identity key — that interpretation happens only in
 * LocalNsecSigner. AD-1: core is UI-free.
 */
// eslint-disable-next-line no-restricted-imports
import * as Keychain from "react-native-keychain"

/** Keychain service namespaces (AD-7 / Consistency conventions: nostr.*).
 *
 * NOTE (2026-08-20, per-account scoping): the identity nsec is now stored under
 * per-account services built by `nostrNsecService(accountKey)` (see account-scope.ts).
 * `NOSTR_NSEC_SERVICE` is the abandoned pre-scoping global slot — kept exported only to
 * mark it; nothing may read or write it (POC no-migration decision; GA cleanup: delete).
 * The transport key stays device-global. */
export const NOSTR_NSEC_SERVICE = "nostr.nsec"
export const NOSTR_TRANSPORT_SERVICE = "nostr.transportKey"

export type NostrKeychainService = string

// Account label is fixed per service; the service is the addressing key.
const ACCOUNT = "nostr"

/**
 * Store an opaque secret (lowercase hex) under `service`, unreadable before first unlock.
 * Both nsec and transport secret use this same AFTER_FIRST_UNLOCK pattern (AD-7). The
 * transport secret is device-local and never backed up (no cloudSync).
 */
export const writeSecret = async (
  service: NostrKeychainService,
  hexValue: string,
): Promise<void> => {
  await Keychain.setGenericPassword(ACCOUNT, hexValue, {
    service,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
  })
}

/**
 * Read the secret stored under `service`. Returns null when absent or unreadable
 * (e.g. before first unlock the keychain returns false) — never throws for absence.
 */
export const readSecret = async (
  service: NostrKeychainService,
): Promise<string | null> => {
  const result = await Keychain.getGenericPassword({ service })
  if (!result) return null
  return result.password
}

/** Remove the secret stored under `service`. */
export const clearSecret = async (service: NostrKeychainService): Promise<void> => {
  await Keychain.resetGenericPassword({ service })
}
