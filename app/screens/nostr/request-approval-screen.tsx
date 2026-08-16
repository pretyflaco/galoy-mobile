import React from "react"
import { View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"

type Props = {
  clientName: string
  /** Human-meaning action (e.g. "decrypt a message") — never raw scope/kind. */
  humanAction: string
  /** The EXACT content that will be signed/decrypted (rendered in full, not a summary). */
  contentPreview: string
  index: number
  total: number
  onApprove: () => void
  onReject: () => void
}

/**
 * Request-approval surface (Story 3.4 / SM-C3). Renders EXACTLY what will be signed/decrypted
 * — the same content SR users get, not a summary — with a "Request X of N from <client>"
 * counter (the sighted mirror of the assertive announcement). Approve/reject are explicit
 * (not gesture-only); the affirmative (approve) is the default focus, never the destructive
 * reject. The surface is an assertive live region so its appearance is announced. All copy is
 * i18n-sourced; nsec/key material never reaches a label or log.
 *
 * The ApprovalCoordinator (this story's core) is the only module that PRESENTS this surface;
 * the coordinator hook drives announce + focus land/trap/restore across the FIFO drain.
 */
export const NostrRequestApprovalScreen: React.FC<Props> = ({
  clientName,
  humanAction,
  contentPreview,
  index,
  total,
  onApprove,
  onReject,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrRequestApprovalScreen

  return (
    <View
      style={styles.container}
      testID="nostr-request-approval"
      accessible
      accessibilityLiveRegion="assertive"
      accessibilityLabel={T.srLabel({
        client: clientName,
        action: humanAction,
        preview: contentPreview,
      })}
    >
      <Text
        type="p3"
        style={styles.counter}
        testID="nostr-request-counter"
        accessibilityLabel={T.announce({
          index,
          total,
          client: clientName,
          action: humanAction,
        })}
      >
        {T.counter({ index, total, client: clientName })}
      </Text>

      <Text type="h2" style={styles.title}>
        {T.title()}
      </Text>

      {/* The EXACT content that will be signed/decrypted (SM-C3: no summary). */}
      <Text type="p2" style={styles.content} testID="nostr-request-content">
        {contentPreview}
      </Text>

      {/* Affirmative (approve) is the default focus target; reject is never default. The
          coordinator hook calls AccessibilityInfo.setAccessibilityFocus on the marked view. */}
      <View testID="nostr-request-default-focus">
        <GaloyPrimaryButton
          title={T.approve()}
          onPress={onApprove}
          testID="nostr-request-approve"
        />
      </View>
      <GaloySecondaryButton
        title={T.reject()}
        onPress={onReject}
        testID="nostr-request-reject"
      />
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    padding: 24,
    rowGap: 16,
  },
  counter: {
    color: colors.grey1,
  },
  title: {
    color: colors.black,
  },
  content: {
    color: colors.black,
  },
}))
