import React from "react"

import { useCreateIdentity } from "./use-create-identity"
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
 */
export const CreateIdentityNavigator: React.FC<CreateIdentityNavigatorProps> = ({
  onImport,
  onBackup,
  onExit,
}) => {
  const { state, busy, start, confirm, retry } = useCreateIdentity()

  if (state.step === "result" && state.identity) {
    return (
      <NostrCreateIdentityResultScreen
        identity={state.identity}
        onBackup={onBackup}
        onNotNow={onExit}
      />
    )
  }

  if (state.step === "confirm" || state.step === "error") {
    return (
      <NostrCreateIdentityConfirmScreen
        state={state}
        busy={busy}
        onConfirm={confirm}
        onCancel={onExit}
        onRetry={retry}
      />
    )
  }

  return <NostrCreateIdentityIntroScreen onCreate={start} onImport={onImport} />
}
