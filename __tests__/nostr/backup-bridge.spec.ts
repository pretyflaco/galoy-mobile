/**
 * Story 1.7 — backup bridge (Task 1) + optional/declining (Task 3).
 * The nsec backup routes through the SAME three methods as the wallet credential-backup
 * flow (Cloud / Keychain / Manual), adapting the nsec into an (identifier, secret) shape.
 * Declining never blocks.
 */
import {
  NostrBackupMethod,
  nostrBackupMethods,
  toCredentialPair,
  isBackupRequired,
} from "../../app/nostr/core/backup-export"

describe("backup method surface reuse (AC-1/Task 1)", () => {
  it("exposes exactly Cloud / Keychain / Manual (the existing three methods)", () => {
    expect(nostrBackupMethods()).toEqual([
      NostrBackupMethod.Cloud,
      NostrBackupMethod.Keychain,
      NostrBackupMethod.Manual,
    ])
  })

  it("adapts the nsec into the credential (identifier, secret) shape: id=npub, secret=nsec", () => {
    const pair = toCredentialPair({ npub: "npub_x", nsecHex: "deadbeef" })
    expect(pair).toEqual({ identifier: "npub_x", secret: "deadbeef" })
  })
})

describe("backup is optional — declining blocks nothing (AC-3)", () => {
  it("backup is NEVER required to proceed (create/connect/sign are un-gated)", () => {
    expect(isBackupRequired()).toBe(false)
  })
})
