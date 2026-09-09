import React, { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, findNodeHandle, ScrollView, View } from "react-native"

import Clipboard from "@react-native-clipboard/clipboard"
import { Input, Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { GaloyTertiaryButton } from "@app/components/atomic/galoy-tertiary-button"
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
 * Import an existing key (spec §7.11, Figma 23296:104811/-error/-success). Paste or scan
 * an nsec; validation runs LIVE — the CTA stays "Paste your key" (disabled) until a valid
 * nsec makes it "Continue". A non-secret or malformed value shows the inline error
 * "Invalid key. Probably something else." and changes NO state. Importing over an EXISTING
 * identity still surfaces the consent-danger replace confirm; a first import commits
 * directly. The nsec is never rendered.
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
  const { phase, busy, validate, submit, confirmReplace, cancel } = useImportIdentity()
  const [pasted, setPasted] = useState("")
  const errorRef = useRef<View>(null)
  // Guard against re-submitting the same scanned value when `submit`'s identity changes
  // (context objects can be unstable under some providers/mocks) — submit is idempotent
  // per value, so one-shot per scanned string is correct.
  const lastScannedRef = useRef<string | null>(null)

  // Feed a scanned value (from the reused scanner) straight into validation.
  useEffect(() => {
    if (!scannedValue || scannedValue === lastScannedRef.current) return
    lastScannedRef.current = scannedValue
    submit(scannedValue)
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

  const { valid, invalid } = validate(pasted)
  const showError = invalid || phase === "invalid"

  const onPaste = async () => {
    const value = await Clipboard.getString()
    if (value) setPasted(value)
  }

  return (
    <View style={styles.screen} {...testProps("nostr-import-screen")}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <View style={styles.iconCircle}>
            <GaloyIcon name="plus" size={32} color={styles.icon.color} />
          </View>
          <Text type="h2" bold style={styles.title}>
            {T.title()}
          </Text>
          <Text type="p2" style={styles.body}>
            {T.body()}
          </Text>
        </View>

        <Input
          label={T.pasteLabel()}
          placeholder={T.pastePlaceholder()}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={pasted}
          onChangeText={setPasted}
          renderErrorMessage={false}
          rightIcon={
            <GaloyTertiaryButton
              clear
              title={T.pasteAction()}
              onPress={onPaste}
              {...testProps("nostr-import-paste-button")}
            />
          }
          {...testProps("nostr-import-paste")}
        />

        {showError ? (
          <View ref={errorRef} accessible accessibilityLiveRegion="assertive">
            <Text
              type="p3"
              style={styles.inlineError}
              {...testProps("nostr-import-error")}
            >
              {T.invalidInline()}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.bottomActions}>
        <GaloyPrimaryButton
          title={valid ? T.continueCta() : T.pasteCta()}
          loading={busy}
          disabled={!valid || busy}
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
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  screen: {
    flex: 1,
    justifyContent: "space-between",
  },
  container: { padding: 20, rowGap: 14 },
  hero: {
    alignItems: "center",
    rowGap: 14,
    paddingVertical: 20,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.grey5,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    color: colors.grey0,
  },
  title: { color: colors.grey0, textAlign: "center" },
  body: { color: colors.grey1, textAlign: "center" },
  inlineError: { color: colors.error },
  actions: { marginTop: 24, rowGap: 12 },
  bottomActions: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    rowGap: 10,
  },
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
