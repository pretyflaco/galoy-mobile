import React from "react"
import { View } from "react-native"

import { ListItem, makeStyles } from "@rn-vui/themed"

import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  onBackup: () => void
  onReplace: () => void
  /** Subtitle under the backup row (e.g. "Backed up: Password manager"), or null. */
  backupStatus: string | null
}

/**
 * Nostr settings hub. Groups the identity-management actions that used to sit on the Identity
 * hub — "Back up your key" and "Replace your identity" — behind a single Settings entry, keeping
 * the hub focused on the profile + connected clients. All copy is i18n-sourced.
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
      <ListItem bottomDivider onPress={onBackup} {...testProps("nostr-settings-backup")}>
        <ListItem.Content>
          <ListItem.Title>{T.backup()}</ListItem.Title>
          {backupStatus ? (
            <ListItem.Subtitle {...testProps("nostr-settings-backup-status")}>
              {backupStatus}
            </ListItem.Subtitle>
          ) : null}
        </ListItem.Content>
        <ListItem.Chevron />
      </ListItem>
      <ListItem
        bottomDivider
        onPress={onReplace}
        {...testProps("nostr-settings-replace")}
      >
        <ListItem.Content>
          <ListItem.Title>{T.replace()}</ListItem.Title>
        </ListItem.Content>
        <ListItem.Chevron />
      </ListItem>
    </View>
  )
}

const useStyles = makeStyles(() => ({
  container: {
    flex: 1,
  },
}))
