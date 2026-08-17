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
 * Connection-approval surface (Story 3.3 / Flow 2). Names the client and states the grant in
 * HUMAN MEANING ONLY — "This app wants to sign you in and sign events on your behalf." NO raw
 * scope (`sign_event:22242`) ever reaches the user or any accessible label. Approve/Reject are
 * explicit controls (not gesture-only); the accessible label follows the Accessibility Floor
 * pattern. All copy is i18n-sourced.
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
      <Text type="h2" style={styles.title}>
        {T.title()}
      </Text>

      {/* App identity row: avatar (client `image`, or an initial-in-circle fallback) + name +
          a de-emphasized "wants your approval" line — mirrors the approval mock's header. */}
      <View style={styles.appRow}>
        <Avatar
          rounded
          size={44}
          {...(clientImage
            ? { source: { uri: clientImage } }
            : { title: (client || "?").charAt(0).toUpperCase() })}
          containerStyle={styles.avatar}
        />
        <View style={styles.appMeta}>
          <Text type="p1" style={styles.clientName}>
            {client}
          </Text>
          <Text type="p3" style={styles.wantsApproval}>
            {T.wantsApproval()}
          </Text>
        </View>
      </View>

      <Text type="p2" style={styles.body}>
        {T.body()}
      </Text>

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
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    padding: 24,
    rowGap: 16,
  },
  title: {
    color: colors.black,
  },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  avatar: {
    backgroundColor: colors.grey4,
  },
  appMeta: {
    flexShrink: 1,
    rowGap: 2,
  },
  clientName: {
    fontWeight: "600",
    color: colors.black,
  },
  wantsApproval: {
    color: colors.grey2,
  },
  body: {
    color: colors.grey1,
  },
}))
