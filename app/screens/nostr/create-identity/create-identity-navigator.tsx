import React, { useCallback, useState } from "react"

import { BackupRequiredModal } from "@app/components/backup-required-modal"
import { BackupStatus, useBackupState } from "@app/self-custodial/providers/backup-state"

import { useCreateIdentity, type IdentityKeySource } from "./use-create-identity"
import { NostrCreateIdentityIntroScreen } from "./intro-screen"
import { NostrCreateIdentityConfirmScreen } from "./confirm-screen"
import { NostrCreateIdentityResultScreen } from "./result-screen"

export type CreateIdentityNavigatorProps = {
  /** Route to the Story 1.6 import flow (wired here; impl is 1.6). */
  onImport: () => void
  /** Route to the Story 1.7 backup flow (stub-safe target; impl is 1.7). */
  onBackup: () => void
  /** Exit the ceremony (Cancel / Not now completion). */
  onExit: () => void
}

/**
 * The three-step creation ceremony (Story 1.5): intro → confirm → result. A single
 * in-memory step machine (no key generated until confirm). Both the empty-state Nostr
 * Identity screen and a consumer deep link land here on `intro` — never auto-generating.
 *
 * On self-custodial accounts the PRIMARY creation path derives the nsec from the wallet
 * seed (NIP-06); a fresh random key stays available as the explicit alternative. The
 * seed path is gated on the wallet seed being BACKED UP (mirrors the Lightning Address
 * gate): without a completed backup, tapping it shows the BackupRequiredModal.
 */
export const CreateIdentityNavigator: React.FC<CreateIdentityNavigatorProps> = ({
  onImport,
  onBackup,
  onExit,
}) => {
  const { state, busy, start, confirm, retry, canDeriveFromSeed } = useCreateIdentity()
  const { backupState } = useBackupState()
  const [backupModalVisible, setBackupModalVisible] = useState(false)
  // Remember the chosen source so the result screen can show the re-derivation note.
  const [derivedFromSeed, setDerivedFromSeed] = useState(false)

  const onCreate = useCallback(
    (source: IdentityKeySource) => {
      if (source === "seed" && backupState.status !== BackupStatus.Completed) {
        setBackupModalVisible(true)
        return
      }
      setDerivedFromSeed(source === "seed")
      start(source)
    },
    [backupState.status, start],
  )

  return (
    <>
      {state.step === "result" && state.identity ? (
        <NostrCreateIdentityResultScreen
          identity={state.identity}
          derivedFromSeed={derivedFromSeed}
          onBackup={onBackup}
          onNotNow={onExit}
        />
      ) : state.step === "confirm" || state.step === "error" ? (
        <NostrCreateIdentityConfirmScreen
          state={state}
          busy={busy}
          onConfirm={confirm}
          onCancel={onExit}
          onRetry={retry}
        />
      ) : (
        <NostrCreateIdentityIntroScreen
          canDeriveFromSeed={canDeriveFromSeed}
          onCreate={onCreate}
          onImport={onImport}
        />
      )}
      <BackupRequiredModal
        isVisible={backupModalVisible}
        onClose={() => setBackupModalVisible(false)}
      />
    </>
  )
}
