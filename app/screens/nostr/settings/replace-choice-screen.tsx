import React, { useState } from "react"
import { ScrollView, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  /** Route to the nsec import flow. */
  onImport: () => void
  /** Enter the create-new ceremony (called only AFTER the destructive consent). */
  onCreateNew: () => void
}

/**
 * Replace-identity choice: import an existing key, or create a brand-new one. Both replace and
 * DISCARD the current key. Import routes to its own flow (which has its own replace consent).
 * "Create a new identity" is destructive with no separate downstream gate, so it shows a
 * {consent-danger} confirmation HERE (Cancel default-focused, the destructive action deliberate)
 * before entering the create ceremony. All copy is i18n-sourced; the nsec is never rendered.
 */
export const NostrReplaceChoiceScreen: React.FC<Props> = ({ onImport, onCreateNew }) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrReplaceChoiceScreen
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View
          style={styles.dangerCard}
          {...testProps("nostr-replace-create-confirm")}
          accessibilityLabel={T.confirmSrLabel()}
        >
          <Text type="h2" style={styles.dangerText}>
            {T.confirmTitle()}
          </Text>
          {/* Consequence text is grey0 (never danger red); container grows, never clips. */}
          <Text type="p1" style={styles.dangerText}>
            {T.confirmConsequence()}
          </Text>
        </View>
        <View style={styles.actions}>
          {/* Cancel is the DEFAULT-focused control; the destructive confirm is deliberate. */}
          <GaloySecondaryButton
            title={T.confirmCancel()}
            onPress={() => setConfirming(false)}
            {...testProps("nostr-replace-create-cancel")}
          />
          <GaloyPrimaryButton
            title={T.confirmContinue()}
            onPress={onCreateNew}
            {...testProps("nostr-replace-create-confirm-yes")}
          />
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      {...testProps("nostr-replace-choice")}
    >
      <Text type="h1" style={styles.title}>
        {T.title()}
      </Text>
      <Text type="p1" style={styles.body}>
        {T.body()}
      </Text>
      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={T.importOption()}
          onPress={onImport}
          {...testProps("nostr-replace-import")}
        />
        <GaloySecondaryButton
          title={T.createOption()}
          onPress={() => setConfirming(true)}
          {...testProps("nostr-replace-create")}
        />
      </View>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: { padding: 20, rowGap: 14 },
  title: { color: colors.grey0 },
  body: { color: colors.grey1 },
  actions: { marginTop: 20, rowGap: 10 },
  dangerCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DC2626", // {consent-danger} on border/accent ONLY
    backgroundColor: colors.grey5,
    rowGap: 14,
  },
  dangerText: { color: colors.grey0 },
}))
