/**
 * BTCPay setup interstitial (one-click BTCPay POC).
 *
 * Shown between the "BTCPay Server" settings row and the magic-link sign-in:
 *  - "first" variant    — celebratory explainer: what BTCPay is, what we set up (store wired
 *                         receive-only to the user's Lightning Address), how sign-in works
 *                         (Nostr identity, no password), and the plan price/trial line. Later
 *                         iterations extend this surface with real subscription state (FR-11/12).
 *  - "returning" variant — short recap + a placeholder plan section (the slot that later shows
 *                         paid-through / renewal state).
 *  - "working" phase    — a brief, deliberate waiting moment (mirrors the QR sign-in flow's
 *                         bounded-wait surface) while the NIP-98 login event is signed and the
 *                         browser opens. Held for a minimum duration even though local signing
 *                         is instant, so the transition reads as a real moment, not a flicker.
 *  - "done" phase       — the browser has the session; offers an open-again action (no dead
 *                         ends).
 *
 * AD-1: the screen is navigation-agnostic — the wrapper in nostr-screens.tsx binds navigation,
 * the runtime, and the setup-detected state.
 */
import React from "react"
import { ActivityIndicator, ScrollView, View } from "react-native"

import { Text, makeStyles, useTheme } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

export type BtcpaySetupVariant = "first" | "returning"
export type BtcpaySetupPhase = "intro" | "working" | "done"

type Props = {
  variant: BtcpaySetupVariant
  phase: BtcpaySetupPhase
  lnAddress: string
  onPrimary: () => void
  onOpenAgain: () => void
}

export const BtcpaySetupScreen: React.FC<Props> = ({
  variant,
  phase,
  lnAddress,
  onPrimary,
  onOpenAgain,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const T = LL.BtcpaySetupScreen

  if (phase === "working") {
    return (
      <View style={styles.workingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text type="h1" style={styles.title}>
          {T.workingTitle()}
        </Text>
        <Text type="p1" style={styles.body}>
          {T.workingBody()}
        </Text>
      </View>
    )
  }

  if (phase === "done") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text type="h1" style={styles.title}>
          {T.doneTitle()}
        </Text>
        <Text type="p1" style={styles.body}>
          {T.doneBody()}
        </Text>
        <View style={styles.actions}>
          <GaloySecondaryButton
            title={T.doneAgain()}
            onPress={onOpenAgain}
            {...testProps("btcpay-setup-open-again")}
          />
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {variant === "first" ? (
        <>
          <Text type="h1" style={styles.title}>
            {T.introTitle()}
          </Text>
          <Text type="p1" style={styles.body}>
            {T.introBody()}
          </Text>
          <Text type="p1" style={styles.body}>
            {T.introLightningAddress({ lnAddress })}
          </Text>
          <Text type="p1" style={styles.body}>
            {T.introIdentity()}
          </Text>
          <Text type="p2" style={styles.price}>
            {T.introPrice()}
          </Text>
        </>
      ) : (
        <>
          <Text type="h1" style={styles.title}>
            {T.readyTitle()}
          </Text>
          <Text type="p1" style={styles.body}>
            {T.readyBody({ lnAddress })}
          </Text>
          <View style={styles.planCard}>
            <Text type="p2" style={styles.planLabel}>
              {T.planLabel()}
            </Text>
            <Text type="p1" style={styles.planValue}>
              {T.planValue()}
            </Text>
            <Text type="p2" style={styles.planNote}>
              {T.planNote()}
            </Text>
          </View>
        </>
      )}
      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={variant === "first" ? T.introCta() : T.readyCta()}
          onPress={onPrimary}
          {...testProps("btcpay-setup-primary")}
        />
      </View>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: { padding: 24, rowGap: 16 },
  workingContainer: {
    flex: 1,
    padding: 24,
    rowGap: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.grey0 },
  body: { color: colors.grey1 },
  price: { color: colors.grey1, fontWeight: "600" },
  planCard: {
    marginTop: 8,
    padding: 16,
    rowGap: 4,
    borderRadius: 12,
    backgroundColor: colors.grey5,
  },
  planLabel: { color: colors.grey2 },
  planValue: { color: colors.grey0, fontWeight: "600" },
  planNote: { color: colors.grey2 },
  actions: { marginTop: 24, rowGap: 12 },
}))
