import React from "react"
import { ActivityIndicator, View } from "react-native"

import { Avatar, Text, makeStyles, useTheme } from "@rn-vui/themed"

import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  /** The connecting client's name/identity (from the connection metadata). */
  clientName?: string
  /** Optional avatar image URL from the connection metadata (NIP-46 `image`). */
  clientImage?: string
}

/**
 * Sign-in waiting surface. After a connection is approved, the client sends its login request (a
 * sign_event, e.g. NIP-98 kind 27235) a moment later over the relay. This full-screen surface
 * bridges that gap: client avatar + name + a spinner + "Waiting for sign-in request…", so the
 * user knows the signer is connected and expecting the login. It is replaced by the request
 * approval surface the instant that request arrives, and dismissed once sign-in is delivered (or
 * after a timeout). Pure presentation; the awaiting state lives in the runtime store.
 */
export const NostrAwaitingFollowupScreen: React.FC<Props> = ({
  clientName,
  clientImage,
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

      <Text type="p1" style={styles.body}>
        {T.body()}
      </Text>
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
}))
