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
import { hexToBytes } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

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
  /** The Blink lightning address — metadata only, names the backup in restore dialogs. */
  lightningAddress?: string
}

/**
 * The password-manager/Drive entry name (2026-08-21): the human-readable Blink account name
 * FIRST (password-manager list views show the beginning), with the full npub embedded for
 * restore-parsing. Android Credential Manager only carries (username, password) for password
 * entries — this composite is the only per-entry naming lever.
 */
export const buildBackupEntryName = (display: string, npub: string): string =>
  `Nostr identity ${display} (${npub})`

/** The Drive filename for an identity backup, named for findability in Drive search. */
export const buildCloudBackupFilename = (display: string): string =>
  `nostr-identity-backup-${display}.json`

/** Hex → bech32 nsec (the portable, self-describing form stored in backups). */
export const toNsecBech32 = (nsecHex: string): string =>
  nip19.nsecEncode(hexToBytes(nsecHex))

/** Accepts bech32 nsec (current) or legacy raw hex; returns lowercase hex. */
export const nsecToHex = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.startsWith("nsec1")) {
    const decoded = nip19.decode(trimmed)
    if (decoded.type !== "nsec") throw new Error("not an nsec")
    return Buffer.from(decoded.data as Uint8Array).toString("hex")
  }
  return trimmed.toLowerCase()
}

/**
 * Build a cloud backup blob for the nsec. Encrypts when a password is given; otherwise
 * writes plaintext ONLY if the user explicitly acknowledged. Throws on the forbidden path.
 * The secret travels as bech32 nsec (portable; restores into any nsec-aware tool).
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

  // Reuse the existing crypto; the bech32 nsec travels in the `mnemonic` secret field.
  return buildBackupPayload(toNsecBech32(input.nsecHex), {
    walletIdentifier: input.npub,
    lightningAddress: input.lightningAddress,
    password: input.password, // undefined ⇒ plaintext (allowed only past the guard above)
  })
}

/**
 * Restore the nsec from a cloud backup blob. Encrypted blobs require the backup password
 * (decrypted locally; Blink never receives it). Returns the nsec HEX; the caller writes it
 * back into the keystore confinement (Story 1.3), NOT wallet-mnemonic storage. Accepts
 * bech32 (current) and legacy raw-hex payloads.
 */
export const restoreNsecFromCloud = (
  blob: string,
  password?: string,
): { nsecHex: string } => {
  if (isEncryptedBackup(blob)) {
    if (!password) throw new Error("encrypted nsec backup requires the backup password")
    const { mnemonic } = parseEncryptedBackupPayload(blob, password)
    return { nsecHex: nsecToHex(mnemonic) }
  }
  const { mnemonic } = parseBackupPayload(blob)
  return { nsecHex: nsecToHex(mnemonic) }
}
