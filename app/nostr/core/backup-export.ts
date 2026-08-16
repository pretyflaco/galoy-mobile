/**
 * nsec backup / export bridge (Story 1.7 / AD-7 / AD-2).
 *
 * This is the SECOND (and only other) module permitted to read the nsec besides
 * LocalNsecSigner (AD-2 boundary). It adapts the nsec into blink-mobile's EXISTING
 * credential-backup crypto (app/utils/backup-payload.ts) and ENFORCES the AD-7 delta for
 * cloud backups:
 *
 *   - default: password-encrypted (PBKDF2-SHA256 + AES-GCM via the existing path);
 *   - fallback: unencrypted ONLY with an explicit plaintext acknowledgment;
 *   - FORBIDDEN: the byte-for-byte passwordless-plaintext write (RNG-audit residual) — for
 *     a non-rotatable identity key this is never reachable.
 *
 * POC (owner-approved): the both-offered superset is built; it satisfies AC-4 under either
 * ratification outcome. If ratification later chooses encrypt-default-only, gate off the
 * plaintext-ack path (a config change, not a rebuild).
 *
 * AD-1: core is UI-free — this is a pure adapter; screens/hooks wire it to the backup UI.
 */
import {
  buildBackupPayload,
  isEncryptedBackup,
  parseBackupPayload,
  parseEncryptedBackupPayload,
} from "@app/utils/backup-payload"

/** The nsec backup reuses the wallet credential-backup flow's three methods (AC-1). */
export const NostrBackupMethod = {
  Cloud: "cloud",
  Keychain: "keychain",
  Manual: "manual",
} as const

export type NostrBackupMethod = (typeof NostrBackupMethod)[keyof typeof NostrBackupMethod]

/** The method surface, in the same order as the wallet backup flow. */
export const nostrBackupMethods = (): NostrBackupMethod[] => [
  NostrBackupMethod.Cloud,
  NostrBackupMethod.Keychain,
  NostrBackupMethod.Manual,
]

/**
 * Adapt the identity into the credential-backup flow's (identifier, secret) shape:
 * identifier = the npub (public, non-secret), secret = the nsec hex.
 */
export const toCredentialPair = (input: {
  npub: string
  nsecHex: string
}): { identifier: string; secret: string } => ({
  identifier: input.npub,
  secret: input.nsecHex,
})

/** Backup is optional (FR-8): declining blocks nothing. Always false. */
export const isBackupRequired = (): boolean => false

/** True only for the forbidden passwordless + unacknowledged cloud write. */
export const isForbiddenPlaintextWrite = (opts: {
  hasPassword: boolean
  acknowledged: boolean
}): boolean => !opts.hasPassword && !opts.acknowledged

export interface BuildNsecCloudBackupInput {
  /** The identity secret, lowercase hex. */
  nsecHex: string
  /** The identity npub (backup identifier; NOT secret). */
  npub: string
  /** Backup password — when present, the blob is encrypted (default path). */
  password?: string
  /** Explicit plaintext-exposure acknowledgment — required for an unencrypted write. */
  acknowledgePlaintext?: boolean
}

/**
 * Build a cloud backup blob for the nsec. Encrypts when a password is given; otherwise
 * writes plaintext ONLY if the user explicitly acknowledged. Throws on the forbidden path.
 */
export const buildNsecCloudBackup = (input: BuildNsecCloudBackupInput): string => {
  const hasPassword = Boolean(input.password)
  const acknowledged = input.acknowledgePlaintext === true

  if (isForbiddenPlaintextWrite({ hasPassword, acknowledged })) {
    throw new Error(
      "cloud nsec backup requires a password or an explicit plaintext acknowledgment (AD-7): " +
        "a passwordless, unacknowledged plaintext write is forbidden for a non-rotatable key",
    )
  }

  // Reuse the existing crypto; the nsec hex travels in the `mnemonic` secret field.
  return buildBackupPayload(input.nsecHex, {
    walletIdentifier: input.npub,
    password: input.password, // undefined ⇒ plaintext (allowed only past the guard above)
  })
}

/**
 * Restore the nsec from a cloud backup blob. Encrypted blobs require the backup password
 * (decrypted locally; Blink never receives it). Returns the nsec hex; the caller writes it
 * back into the keystore confinement (Story 1.3), NOT wallet-mnemonic storage.
 */
export const restoreNsecFromCloud = (
  blob: string,
  password?: string,
): { nsecHex: string } => {
  if (isEncryptedBackup(blob)) {
    if (!password) throw new Error("encrypted nsec backup requires the backup password")
    const { mnemonic } = parseEncryptedBackupPayload(blob, password)
    return { nsecHex: mnemonic }
  }
  const { mnemonic } = parseBackupPayload(blob)
  return { nsecHex: mnemonic }
}
