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
  onApprove: () => void
  onReject: () => void
}

/**
 * Connection request surface (Story 3.3 + redesign r3, spec §7.12, Figma 23301:105784):
 * a centered hero — the app avatar in a ring, its name, and the grant in HUMAN MEANING
 * ONLY ("This app wants to sign you in and sign events on your behalf."). NO raw scope
 * (`sign_event:22242`) ever reaches the user or any accessible label. Approve/Reject are
 * explicit controls pinned to the bottom; the accessible label follows the Accessibility
 * Floor pattern. All copy is i18n-sourced.
 *
 * NOTE: the ApprovalCoordinator (Story 3.4) is the module that PRESENTS this surface and owns
 * focus land/trap/restore + queue-position announcement. This screen is the rendered content.
 */
export const NostrConnectionApprovalScreen: React.FC<Props> = ({
  clientName,
  clientImage,
  onApprove,
  onReject,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrConnectionApprovalScreen
  const client = clientName ?? T.unknownClient()

  return (
    <View
      style={styles.container}
      testID="nostr-connection-approval"
      accessible
      accessibilityLabel={T.srLabel({ client })}
    >
      <Text type="h2" bold style={styles.title}>
        {T.title()}
      </Text>

      <View style={styles.hero}>
        {/* App identity: avatar (client `image`, or an initial-in-circle fallback) in a
            ring — mirrors the Figma connection-request hero. */}
        <View style={styles.avatarRing}>
          <Avatar
            rounded
            size={44}
            {...(clientImage
              ? { source: { uri: clientImage } }
              : { title: (client || "?").charAt(0).toUpperCase() })}
            containerStyle={styles.avatar}
          />
        </View>
        <Text type="h2" bold style={styles.clientName}>
          {client}
        </Text>
        <Text type="p2" style={styles.body}>
          {T.body()}
        </Text>
      </View>

      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={T.approve()}
          onPress={onApprove}
          {...testProps("nostr-connection-approve")}
        />
        <GaloySecondaryButton
          title={T.reject()}
          onPress={onReject}
          {...testProps("nostr-connection-reject")}
        />
      </View>
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    justifyContent: "space-between",
    padding: 20,
  },
  title: {
    color: colors.grey0,
  },
  hero: {
    alignItems: "center",
    rowGap: 14,
    paddingHorizontal: 20,
  },
  avatarRing: {
    borderRadius: 26,
    borderWidth: 1.4,
    borderColor: colors.grey3,
  },
  avatar: {
    backgroundColor: colors.grey4,
  },
  clientName: {
    color: colors.grey0,
    textAlign: "center",
  },
  body: {
    color: colors.grey1,
    textAlign: "center",
  },
  actions: {
    rowGap: 10,
  },
}))
