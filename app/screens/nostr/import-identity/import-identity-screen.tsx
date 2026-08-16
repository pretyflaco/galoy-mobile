import React, { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, findNodeHandle, ScrollView, View } from "react-native"

import { Input, Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { GaloyErrorBox } from "@app/components/atomic/galoy-error-box"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

import { useImportIdentity } from "./use-import-identity"

type Props = {
  /** Navigate to the EXISTING QR scanner (route "scanningQRCode"); returns a scanned string. */
  onScan: () => void
  /** Called with a value already captured elsewhere (e.g. the scanner callback). */
  scannedValue?: string
  onDone: () => void
  onCancel: () => void
}

/**
 * nsec import / replace (Story 1.6). Paste input + scan affordance (reuses the existing
 * scanner via `onScan` → route "scanningQRCode"; NO new scanner). Invalid input shows a
 * clear error and changes NO state. A valid nsec surfaces a consent-danger replace
 * confirm whose destructive control is off the default focus. The nsec is never rendered.
 */
export const NostrImportIdentityScreen: React.FC<Props> = ({
  onScan,
  scannedValue,
  onDone,
  onCancel,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrImportIdentityScreen
  const { phase, busy, submit, confirmReplace, cancel } = useImportIdentity()
  const [pasted, setPasted] = useState("")
  const errorRef = useRef<View>(null)

  // Feed a scanned value (from the reused scanner) straight into validation.
  useEffect(() => {
    if (scannedValue) submit(scannedValue)
  }, [scannedValue, submit])

  useEffect(() => {
    if (phase !== "invalid") return
    const node = findNodeHandle(errorRef.current)
    if (node) AccessibilityInfo.setAccessibilityFocus(node)
    AccessibilityInfo.announceForAccessibility(T.invalidUnchanged())
  }, [phase, T])

  useEffect(() => {
    if (phase === "done") onDone()
  }, [phase, onDone])

  if (phase === "confirm") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View
          style={styles.dangerCard}
          accessible
          accessibilityLabel={T.replaceSrLabel()}
        >
          <Text type="h2" style={styles.dangerText}>
            {T.replaceTitle()}
          </Text>
          {/* Consequence text is grey0 (never danger red); container grows, never clips. */}
          <Text type="p1" style={styles.dangerText}>
            {T.replaceConsequence()}
          </Text>
        </View>
        <View style={styles.actions}>
          {/* Cancel is the DEFAULT-focused control; the destructive confirm is deliberate. */}
          <GaloySecondaryButton
            title={T.replaceCancel()}
            onPress={cancel}
            {...testProps("nostr-import-cancel")}
          />
          <GaloyPrimaryButton
            title={T.replaceConfirm()}
            loading={busy}
            disabled={busy}
            onPress={confirmReplace}
            {...testProps("nostr-import-confirm-replace")}
          />
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text type="h1" style={styles.title}>
        {T.title()}
      </Text>
      <Text type="p1" style={styles.body}>
        {T.body()}
      </Text>

      <Input
        label={T.pasteLabel()}
        placeholder={T.pastePlaceholder()}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        value={pasted}
        onChangeText={setPasted}
        {...testProps("nostr-import-paste")}
      />

      {phase === "invalid" ? (
        <View ref={errorRef} accessible accessibilityLiveRegion="assertive">
          <Text type="h2" style={styles.title}>
            {T.invalidTitle()}
          </Text>
          <GaloyErrorBox errorMessage={T.invalidBody()} />
        </View>
      ) : null}

      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={T.continueCta()}
          onPress={() => submit(pasted)}
          {...testProps("nostr-import-continue")}
        />
        <GaloySecondaryButton
          title={T.scanCta()}
          onPress={onScan}
          {...testProps("nostr-import-scan")}
        />
        <GaloySecondaryButton
          title={T.replaceCancel()}
          onPress={onCancel}
          {...testProps("nostr-import-exit")}
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
  dangerCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DC2626", // {consent-danger} on border/accent ONLY
    backgroundColor: colors.grey5, // wash; text stays grey0 for ≥4.5:1
    rowGap: 12,
  },
  dangerText: { color: colors.grey0 }, // consequence text NEVER danger red
}))
