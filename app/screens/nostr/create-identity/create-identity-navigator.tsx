import React, { useEffect } from "react"
import { View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyErrorBox } from "@app/components/atomic/galoy-error-box"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

import { NostrChooseKeySourceScreen } from "./choose-source-screen"
import { NostrGeneratingScreen } from "./generating-screen"
import { useCreateIdentity, type CreatePhase } from "./use-create-identity"

export type CreateIdentityNavigatorProps = {
  /** Exit the flow — success (identity created → Hub) and Cancel both land here. */
  onExit: () => void
  /** Step changes (the route wrapper switches the header title: Create new / Generating…). */
  onPhaseChange?: (phase: CreatePhase) => void
}

/**
 * The creation flow (redesign r3, spec §6.1–6.4):
 *
 *   [choose key source]  — ONLY when a backed-up wallet phrase exists
 *   → Generating         — transient; the ONLY screen between decision and Hub
 *   → Hub                — no confirm step, no result/ownership screen
 *
 * Accounts without a usable wallet phrase (custodial, or seed not yet backed up) skip the
 * choice entirely and generate a fresh random key immediately on entry. A fail-closed
 * error offers Try Again / Cancel; no partial identity can persist.
 */
export const CreateIdentityNavigator: React.FC<CreateIdentityNavigatorProps> = ({
  onExit,
  onPhaseChange,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrCreateIdentityScreen
  const { phase, error, create, retry, canChooseSource, source } = useCreateIdentity()

  useEffect(() => {
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])

  // No wallet phrase to derive from → no choice to present (spec §7.3): start a random
  // key immediately. Guarded by phase so a retry after error doesn't double-fire.
  useEffect(() => {
    if (!canChooseSource && phase === "choose") create("random")
  }, [canChooseSource, phase, create])

  // Generation committed → straight back to the Hub (which reloads on focus).
  useEffect(() => {
    if (phase === "done") onExit()
  }, [phase, onExit])

  if (phase === "error") {
    return (
      <View style={styles.errorContainer} {...testProps("nostr-generating-error")}>
        <View style={styles.errorBody}>
          <Text type="h2" bold style={styles.errorTitle}>
            {T.errorTitle()}
          </Text>
          <GaloyErrorBox errorMessage={error?.message ?? T.errorBody()} />
        </View>
        <View style={styles.errorActions}>
          <GaloyPrimaryButton
            title={T.errorTryAgain()}
            onPress={retry}
            {...testProps("nostr-generating-retry")}
          />
          <GaloySecondaryButton
            title={T.errorCancel()}
            onPress={onExit}
            {...testProps("nostr-generating-cancel")}
          />
        </View>
      </View>
    )
  }

  if (phase === "generating" || phase === "done") {
    return <NostrGeneratingScreen source={source} />
  }

  return <NostrChooseKeySourceScreen onChoose={create} />
}

const useStyles = makeStyles(() => ({
  errorContainer: {
    flex: 1,
    justifyContent: "space-between",
    padding: 20,
  },
  errorBody: {
    rowGap: 14,
  },
  errorTitle: {
    textAlign: "center",
  },
  errorActions: {
    rowGap: 10,
  },
}))
