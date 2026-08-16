import React, { useEffect, useRef } from "react"
import { AccessibilityInfo, findNodeHandle, ScrollView, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { GaloyErrorBox } from "@app/components/atomic/galoy-error-box"
import { useI18nContext } from "@app/i18n/i18n-react"
import type { CeremonyState } from "@app/nostr/core/identity"
import { testProps } from "@app/utils/testProps"

type Props = {
  state: CeremonyState
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  onRetry: () => void
}

/**
 * Ceremony step 2 — confirm/agency (Story 1.5 / Task 3). On confirm the key is generated
 * (fail-closed). The error state moves focus to the error, associates the "unchanged"
 * message via a live region, and offers Try Again + Cancel (never an infinite spinner).
 */
export const NostrCreateIdentityConfirmScreen: React.FC<Props> = ({
  state,
  busy,
  onConfirm,
  onCancel,
  onRetry,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrCreateIdentityScreen
  const errorRef = useRef<View>(null)
  const isError = state.step === "error"

  useEffect(() => {
    if (!isError) return
    // a11y: move focus to the error and announce that nothing changed.
    const node = findNodeHandle(errorRef.current)
    if (node) AccessibilityInfo.setAccessibilityFocus(node)
    AccessibilityInfo.announceForAccessibility(T.errorUnchanged())
  }, [isError, T])

  if (isError) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View ref={errorRef} accessible accessibilityLiveRegion="assertive">
          <Text type="h2" style={styles.title}>
            {T.errorTitle()}
          </Text>
          <GaloyErrorBox errorMessage={T.errorBody()} />
        </View>
        <View style={styles.actions}>
          <GaloyPrimaryButton
            title={T.errorTryAgain()}
            onPress={onRetry}
            {...testProps("nostr-ceremony-try-again")}
          />
          <GaloySecondaryButton
            title={T.errorCancel()}
            onPress={onCancel}
            {...testProps("nostr-ceremony-error-cancel")}
          />
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text type="h1" style={styles.title}>
        {T.confirmTitle()}
      </Text>
      <Text type="p1" style={styles.body}>
        {T.confirmBody()}
      </Text>
      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={busy ? T.generating() : T.confirmCta()}
          loading={busy}
          disabled={busy}
          onPress={onConfirm}
          {...testProps("nostr-ceremony-confirm")}
        />
        <GaloySecondaryButton
          title={T.confirmCancel()}
          onPress={onCancel}
          disabled={busy}
          {...testProps("nostr-ceremony-confirm-cancel")}
        />
      </View>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: { padding: 24, rowGap: 16 },
  title: { color: colors.grey0 },
  body: { color: colors.grey1 },
  actions: { marginTop: 24, rowGap: 12 },
}))
