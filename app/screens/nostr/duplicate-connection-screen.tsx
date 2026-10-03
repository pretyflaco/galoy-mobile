import React from "react"
import { View } from "react-native"

import { Avatar, Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  /** The connecting client's name/identity (from the nostrconnect:// URI metadata). */
  clientName?: string
  /** Optional avatar image URL from the connection metadata (NIP-46 `image`). */
  clientImage?: string
  onReplace: () => void
  onKeepBoth: () => void
  onCancel: () => void
}

/**
 * Duplicate-connection prompt (fix #4). Shown when an app that is ALREADY connected (matched by
 * identity: metadata.url ?? metadata.name) re-connects under a fresh ephemeral pubkey. Rather
 * than silently accreting a duplicate row per sign-in, the user chooses: Replace the old
 * connection, Keep both, or Cancel. All copy is i18n-sourced; no raw pubkey/scope is surfaced.
 */
export const NostrDuplicateConnectionScreen: React.FC<Props> = ({
  clientName,
  clientImage,
  onReplace,
  onKeepBoth,
  onCancel,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrDuplicateConnectionScreen
  const client = clientName ?? ""

  return (
    <View
      style={styles.container}
      testID="nostr-duplicate-connection"
      accessible
      accessibilityLabel={T.srLabel({ client })}
    >
      <View style={styles.appRow}>
        <Avatar
          rounded
          size={44}
          {...(clientImage
            ? { source: { uri: clientImage } }
            : { title: (client || "?").charAt(0).toUpperCase() })}
          containerStyle={styles.avatar}
        />
        <Text type="h2" style={styles.title}>
          {T.title({ client })}
        </Text>
      </View>

      <Text type="p2" style={styles.body}>
        {T.body()}
      </Text>

      <GaloyPrimaryButton
        title={T.replace()}
        onPress={onReplace}
        {...testProps("nostr-duplicate-replace")}
        accessibilityLabel={T.replaceA11y({ client })}
      />
      <GaloySecondaryButton
        title={T.keepBoth()}
        onPress={onKeepBoth}
        {...testProps("nostr-duplicate-keep-both")}
        accessibilityLabel={T.keepBothA11y({ client })}
      />
      <GaloySecondaryButton
        title={T.cancel()}
        onPress={onCancel}
        {...testProps("nostr-duplicate-cancel")}
      />
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    padding: 20,
    rowGap: 14,
  },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  avatar: {
    backgroundColor: colors.grey4,
  },
  title: {
    flexShrink: 1,
    color: colors.black,
  },
  body: {
    color: colors.grey1,
  },
}))
