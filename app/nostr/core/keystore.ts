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

/**
 * M20 (Hermes re-review #3): secrets that must NEVER leave this device — not even via
 * an encrypted iCloud/iTunes backup. `AFTER_FIRST_UNLOCK` items are INCLUDED in such
 * backups, so a restore onto another phone carried the support chat's keys and (via
 * the also-backed-up AsyncStorage) its whole history. `…_THIS_DEVICE_ONLY` items are
 * excluded from backups; the ciphertext in a restored backup is then useless.
 *
 * Hermes B: on iOS setGenericPassword is delete-then-insert, so re-writing the SAME
 * service on every read risks losing the key to a mid-rewrite kill. Device-only
 * secrets therefore live under a dedicated service name (`<service>.tdo`) that is
 * written exactly once; a legacy item under the plain name is migrated by
 * copy → verify → delete, never delete-then-insert.
 */
const tdoService = (service: NostrKeychainService): string => `${service}.tdo`

export const writeSecretThisDeviceOnly = async (
  service: NostrKeychainService,
  hexValue: string,
): Promise<void> => {
  await Keychain.setGenericPassword(ACCOUNT, hexValue, {
    service: tdoService(service),
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  })
}

/**
 * Read a this-device-only secret. First the dedicated name; a legacy (backup-able)
 * item under the plain name is migrated in place (same value — conversations survive).
 */
export const readSecretThisDeviceOnly = async (
  service: NostrKeychainService,
): Promise<string | null> => {
  const fresh = await Keychain.getGenericPassword({ service: tdoService(service) })
  if (fresh) return fresh.password
  const legacy = await Keychain.getGenericPassword({ service })
  if (!legacy) return null
  await writeSecretThisDeviceOnly(service, legacy.password)
  const check = await Keychain.getGenericPassword({ service: tdoService(service) })
  if (!check || check.password !== legacy.password)
    throw new Error(`keychain migration failed for ${service}`)
  await Keychain.resetGenericPassword({ service })
  return legacy.password
}
