import React from "react"
import { ScrollView, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  /** Route to the nsec import flow. */
  onImport: () => void
  /** Enter the create-new flow (same routing as first-run creation, spec §7.10). */
  onCreateNew: () => void
}

/**
 * Replace your identity (spec §7.10): the destructive warning IS the screen content —
 * "This permanently discards your current key. Connected apps will stop working until you
 * reconnect. Back up your key first if you might need it." Create new follows the first-run
 * routing (choose key source when a wallet phrase is available, else straight to
 * Generating); Import existing routes to the import flow. Back aborts; the current identity
 * is unchanged until a replacement commits. The nsec is never rendered.
 */
export const NostrReplaceChoiceScreen: React.FC<Props> = ({ onImport, onCreateNew }) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrReplaceChoiceScreen

  return (
    <View style={styles.container} {...testProps("nostr-replace-choice")}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Consequence text is grey0 (never danger red); the {consent-danger} accent stays
            on the border only. */}
        <View style={styles.dangerCard} accessibilityLabel={T.confirmSrLabel()}>
          <Text type="p1" style={styles.dangerText}>
            {T.body()}
          </Text>
        </View>
      </ScrollView>
      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={T.createOption()}
          onPress={onCreateNew}
          {...testProps("nostr-replace-create")}
        />
        <GaloySecondaryButton
          title={T.importOption()}
          onPress={onImport}
          {...testProps("nostr-replace-import")}
        />
      </View>
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    justifyContent: "space-between",
  },
  content: {
    padding: 20,
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    rowGap: 10,
  },
  dangerCard: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#DC2626", // {consent-danger} on border/accent ONLY
    backgroundColor: colors.grey5, // wash; text stays grey0 for ≥4.5:1
  },
  dangerText: { color: colors.grey0 }, // consequence text NEVER danger red
}))
