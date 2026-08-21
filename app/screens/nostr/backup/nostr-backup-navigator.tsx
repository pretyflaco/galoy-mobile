import React, { useState } from "react"

import { NostrBackupMethodScreen } from "./backup-method-screen"
import { NostrCloudBackupScreen } from "./cloud-backup-screen"
import { NostrManualBackupScreen } from "./manual-backup-screen"
import { useNostrBackup } from "./use-nostr-backup"

type Step = "method" | "cloud" | "manual"

type Props = {
  /** Exit the backup flow (done / not-now / cancel all land here). */
  onExit: () => void
}

/**
 * Nostr identity backup navigator (2026-08-21): method chooser → Google Drive / Password
 * Manager / Manual, mirroring the Spark recovery-phrase backup structure. Backup is optional
 * (FR-8): every exit path is unblocked.
 */
export const NostrBackupNavigator: React.FC<Props> = ({ onExit }) => {
  const [step, setStep] = useState<Step>("method")
  const { busy, readNsecBech32, saveToPasswordManager, uploadToCloud, markDone } =
    useNostrBackup()

  if (step === "cloud") {
    return (
      <NostrCloudBackupScreen
        busy={busy}
        onUpload={async (opts) => {
          const result = await uploadToCloud(opts)
          if (result !== "failed") onExit()
        }}
        onCancel={() => setStep("method")}
      />
    )
  }

  if (step === "manual") {
    return (
      <NostrManualBackupScreen
        loadNsec={readNsecBech32}
        onDone={() => {
          markDone("manual")
          onExit()
        }}
      />
    )
  }

  return (
    <NostrBackupMethodScreen
      busy={busy}
      onCloud={() => setStep("cloud")}
      onPasswordManager={async () => {
        const result = await saveToPasswordManager()
        if (result !== "failed") onExit()
      }}
      onManual={() => setStep("manual")}
      onNotNow={onExit}
    />
  )
}
