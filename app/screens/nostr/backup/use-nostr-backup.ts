/**
 * Nostr identity backup hook (2026-08-21). Reads the ACTIVE account's scoped nsec
 * (`nostr.nsec.<accountKey>`) and drives the three backup methods with Spark-flow parity:
 *  - Password Manager: generic credential save; the entry name is a composite
 *    `Nostr identity <account-name> (<npub>)` (Credential Manager exposes only username+password
 *    for password entries — this is the only per-entry naming lever), secret = bech32 nsec;
 *  - Google Drive: platform cloud upload; file named `nostr-identity-backup-<account>.json`,
 *    payload carries the bech32 nsec + the Blink lightning address as metadata;
 *  - Manual: exposes the bech32 nsec for the reveal screen.
 *
 * The nsec read is a transient local variable only — never stored in state beyond the flow.
 */
import { useCallback, useMemo, useState } from "react"

import { hexToBytes } from "@noble/hashes/utils.js"
import { schnorr } from "@noble/curves/secp256k1.js"
import * as nip19 from "nostr-tools/nip19"

import { useAppConfig } from "@app/hooks"
import { useI18nContext } from "@app/i18n/i18n-react"
import { nostrNsecService } from "@app/nostr/core/account-scope"
import {
  buildBackupEntryName,
  buildCloudBackupFilename,
  buildNsecCloudBackup,
  toNsecBech32,
} from "@app/nostr/core/backup-export"
import { readSecret } from "@app/nostr/core/keystore"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"
import {
  CredentialError,
  useCredentialBackup,
} from "@app/screens/self-custodial/onboarding/hooks/use-credential-backup"
import { usePlatformCloudBackup } from "@app/screens/self-custodial/onboarding/hooks/use-platform-cloud-backup"
import { getCloudProviderName } from "@app/screens/self-custodial/onboarding/utils"
import { usePayLinks } from "@app/screens/settings-screen/settings/use-pay-links"
import { CloudBackupErrorReason } from "@app/types/cloud-backup"
import { confirmDialog } from "@app/utils/confirm-dialog"
import { saveString } from "@app/utils/storage/storage"
import { toastShow } from "@app/utils/toast"

export type NostrBackupActionResult = "done" | "cancelled" | "failed"

/** Per-account "backed up" marker (drives the identity-settings row status). */
export const nostrBackupDoneKey = (accountKey: string): string =>
  `nostr.backupDone.${accountKey}`

export const useNostrBackup = () => {
  const { LL } = useI18nContext()
  const nostr = useNostrRuntime()
  const accountKey = nostr?.accountKey ?? null
  const credential = useCredentialBackup()
  const cloud = usePlatformCloudBackup()
  const [busy, setBusy] = useState(false)

  const { username } = usePayLinks()
  const {
    appConfig: {
      galoyInstance: { lnAddressHostname },
    },
  } = useAppConfig()

  /** Human-readable account name for backup entries; falls back to the account id. */
  const displayName = useMemo(
    () => (username ? `${username}@${lnAddressHostname}` : accountKey ?? "unknown"),
    [username, lnAddressHostname, accountKey],
  )

  const markDone = useCallback(
    (method: string) => {
      if (!accountKey) return
      saveString(nostrBackupDoneKey(accountKey), method).catch(() => undefined)
    },
    [accountKey],
  )

  /** Read the active account's identity as (nsecHex, npub). Null when unavailable. */
  const readIdentity = useCallback(async (): Promise<{
    nsecHex: string
    npub: string
  } | null> => {
    if (!accountKey) return null
    const nsecHex = await readSecret(nostrNsecService(accountKey))
    if (!nsecHex) return null
    const pubkeyHex = Buffer.from(schnorr.getPublicKey(hexToBytes(nsecHex))).toString(
      "hex",
    )
    return { nsecHex, npub: nip19.npubEncode(pubkeyHex) }
  }, [accountKey])

  /** The bech32 nsec for the manual reveal screen. */
  const readNsecBech32 = useCallback(async (): Promise<string | null> => {
    const identity = await readIdentity()
    return identity ? toNsecBech32(identity.nsecHex) : null
  }, [readIdentity])

  const saveToPasswordManager =
    useCallback(async (): Promise<NostrBackupActionResult> => {
      setBusy(true)
      try {
        const identity = await readIdentity()
        if (!identity) return "failed"
        const entryName = buildBackupEntryName(displayName, identity.npub)
        const result = await credential.save(entryName, toNsecBech32(identity.nsecHex))
        if (result.success) {
          markDone("keychain")
          toastShow({
            message: LL.NostrBackupScreen.savedToPasswordManager({ name: entryName }),
            type: "success",
            LL,
          })
          return "done"
        }
        if (result.error === CredentialError.UserCancelled) return "cancelled"
        toastShow({
          message:
            result.error === CredentialError.Unknown
              ? LL.BackupScreen.BackupMethod.passwordManagerBackupFailed()
              : LL.BackupScreen.BackupMethod.passwordManagerUnavailable(),
          LL,
        })
        return "failed"
      } catch {
        return "failed"
      } finally {
        setBusy(false)
      }
    }, [credential, readIdentity, displayName, markDone, LL])

  /**
   * Google Drive upload. `password` set ⇒ encrypted payload; `acknowledgePlaintext` ⇒ the
   * AD-7 plaintext path (the screen collects the explicit acknowledgment first).
   */
  const uploadToCloud = useCallback(
    async (opts: {
      password?: string
      acknowledgePlaintext?: boolean
    }): Promise<NostrBackupActionResult> => {
      setBusy(true)
      try {
        const identity = await readIdentity()
        if (!identity) return "failed"
        const provider = getCloudProviderName(LL)
        const toastFailure = (reason: CloudBackupErrorReason) => {
          if (reason === CloudBackupErrorReason.Cancelled) return
          toastShow({ message: cloud.resolveErrorMessage(reason, LL), LL })
        }

        const filename = buildCloudBackupFilename(displayName)
        const sessionResult = await cloud.startSession(filename)
        if (!sessionResult.success) {
          toastFailure(sessionResult.reason)
          return "failed"
        }
        const { session } = sessionResult
        const { accessToken } = session

        if (session.existingFileId) {
          const downloadResult = await cloud.downloadById(
            session.existingFileId,
            accessToken,
          )
          if (
            !downloadResult.success &&
            downloadResult.reason !== CloudBackupErrorReason.NotFound
          ) {
            toastFailure(downloadResult.reason)
            return "failed"
          }
          const confirmed = await confirmDialog({
            title: LL.BackupScreen.CloudBackup.existingBackupTitle(),
            message: LL.BackupScreen.CloudBackup.existingBackupMessage({ provider }),
            labels: {
              cancel: LL.common.cancel(),
              confirm: LL.BackupScreen.CloudBackup.overwrite(),
            },
          })
          if (!confirmed) return "cancelled"
        }

        const payload = buildNsecCloudBackup({
          nsecHex: identity.nsecHex,
          npub: identity.npub,
          lightningAddress: displayName.includes("@") ? displayName : undefined,
          password: opts.password || undefined,
          acknowledgePlaintext: opts.acknowledgePlaintext,
        })
        const result = await cloud.upload(payload, filename, session)
        if (!result.success) {
          toastFailure(result.reason)
          return "failed"
        }
        markDone("cloud")
        toastShow({
          message: LL.NostrBackupScreen.savedToCloud({ provider, name: filename }),
          type: "success",
          LL,
        })
        return "done"
      } catch {
        return "failed"
      } finally {
        setBusy(false)
      }
    },
    [cloud, readIdentity, displayName, markDone, LL],
  )

  return {
    busy: busy || credential.loading,
    readIdentity,
    readNsecBech32,
    saveToPasswordManager,
    uploadToCloud,
    markDone,
  }
}
