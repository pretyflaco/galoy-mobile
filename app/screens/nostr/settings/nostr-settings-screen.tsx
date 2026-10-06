import React from "react"
import { TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  onBackup: () => void
  onReplace: () => void
  /** Subtitle under the backup row (e.g. "Backed up: Password manager"), or null. */
  backupStatus: string | null
}

/**
 * Nostr Identity Settings (spec §7.7, Figma 23266:104275): a single grouped card with
 * "Backup your key" → Choose your backup method and "Replace your identity" → the
 * destructive replace flow. All copy is i18n-sourced.
 */
export const NostrSettingsScreen: React.FC<Props> = ({
  onBackup,
  onReplace,
  backupStatus,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrSettingsScreen

  return (
    <View style={styles.container} {...testProps("nostr-settings")}>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.row}
          accessibilityRole="button"
          onPress={onBackup}
          {...testProps("nostr-settings-backup")}
        >
          <View style={styles.rowText}>
            <Text type="p3" style={styles.rowTitle}>
              {T.backup()}
            </Text>
            {backupStatus ? (
              <Text
                type="p4"
                style={styles.rowSubtitle}
                {...testProps("nostr-settings-backup-status")}
              >
                {backupStatus}
              </Text>
            ) : null}
          </View>
          <GaloyIcon name="caret-right" size={16} color={styles.chevron.color} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity
          style={styles.row}
          accessibilityRole="button"
          onPress={onReplace}
          {...testProps("nostr-settings-replace")}
        >
          <View style={styles.rowText}>
            <Text type="p3" style={styles.rowTitle}>
              {T.replace()}
            </Text>
          </View>
          <GaloyIcon name="caret-right" size={16} color={styles.chevron.color} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  card: {
    backgroundColor: colors.grey5,
    borderRadius: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 14,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 10,
    minHeight: 48,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: colors.grey0,
  },
  rowSubtitle: {
    color: colors.grey3,
  },
  divider: {
    height: 1,
    backgroundColor: colors.grey4,
    marginHorizontal: 14,
  },
  chevron: {
    color: colors.grey0,
  },
}))
