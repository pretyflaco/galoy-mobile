import React from "react"
import { ActivityIndicator, View } from "react-native"

import { Avatar, Text, makeStyles, useTheme } from "@rn-vui/themed"

import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  /** The connecting client's name/identity (from the connection metadata). */
  clientName?: string
  /** Optional avatar image URL from the connection metadata (NIP-46 `image`). */
  clientImage?: string
  /**
   * Leave the waiting surface. Same-device mobile flows can strand here (the client app is
   * suspended in the background and never sends its sign-in challenge), so the user must
   * always be able to walk away — this is the one affordance the pure spinner otherwise lacks.
   */
  onCancel: () => void
}

/**
 * Sign-in waiting surface. After a connection is approved, the client sends its login request (a
 * sign_event, e.g. NIP-98 kind 27235) a moment later over the relay. This full-screen surface
 * bridges that gap: client avatar + name + a spinner + "Waiting for sign-in challenge from app…"
 * plus a hint that a second approval may appear (a slow app that does not pre-grant its login kind
 * raises a per-request approval). It is replaced by the request approval surface the instant that
 * request arrives, and dismissed once sign-in is delivered (or after the sliding idle timeout).
 * Pure presentation; the awaiting state lives in the runtime store.
 */
export const NostrAwaitingFollowupScreen: React.FC<Props> = ({
  clientName,
  clientImage,
  onCancel,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const T = LL.NostrAwaitingFollowupScreen
  const client = clientName ?? ""

  return (
    <View
      style={styles.container}
      testID="nostr-awaiting-followup"
      accessible
      accessibilityLabel={T.srLabel({ client })}
    >
      <Avatar
        rounded
        size={64}
        {...(clientImage
          ? { source: { uri: clientImage } }
          : { title: (client || "?").charAt(0).toUpperCase() })}
        containerStyle={styles.avatar}
      />
      {client ? (
        <Text type="h2" style={styles.name}>
          {client}
        </Text>
      ) : null}

      <ActivityIndicator
        size="large"
        color={colors.primary}
        {...testProps("nostr-awaiting-spinner")}
      />

      <Text type="p1" style={styles.body} testID="nostr-awaiting-body">
        {T.body()}
      </Text>
      <Text type="p3" style={styles.hint} testID="nostr-awaiting-hint">
        {T.hint()}
      </Text>
      <GaloySecondaryButton
        title={T.cancel()}
        onPress={onCancel}
        {...testProps("nostr-awaiting-cancel")}
      />
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 20,
    padding: 20,
  },
  avatar: {
    backgroundColor: colors.grey4,
  },
  name: {
    color: colors.black,
    textAlign: "center",
  },
  body: {
    color: colors.grey2,
    textAlign: "center",
  },
  hint: {
    color: colors.grey3,
    textAlign: "center",
  },
}))
