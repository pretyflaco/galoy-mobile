import React, { useState } from "react"
import { ScrollView, TouchableOpacity, View } from "react-native"

import { Avatar, Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"

import { capitalizeAction, isDrasticFollowShrink, nostrActionLabel } from "./action-label"

type Props = {
  clientName: string
  /** Optional avatar image URL from the connection metadata (NIP-46 `image`). */
  clientImage?: string
  /** Fallback action phrase — used only when method/kind cannot be classified. */
  humanAction: string
  /** NIP-46 method (sign_event, nip44_decrypt, …) — drives the plain-language action. */
  method?: string
  /** For sign_event, the event kind (e.g. 3 follow list, 27235 http-auth). */
  eventKind?: number
  /** For a kind-27235 sign_event: normalized host of the `u` tag. */
  uHost?: string | null
  /** For a kind:3 sign_event: published vs proposed follow counts (issue #2 mitigation). */
  followListDelta?: { before: number; after: number }
  /** Bounded summary of the EXACT content (what is signed is unchanged). */
  contentPreview: string
  /** The EXACT untruncated content; when it differs from the summary, an expander is offered. */
  contentPreviewFull?: string
  index: number
  total: number
  onApprove: () => void
  onReject: () => void
}

/**
 * Request-approval surface (Story 3.4 / SM-C3). Renders what will be signed/decrypted with a
 * "Request X of N from <client>" counter (the sighted mirror of the assertive announcement).
 * Approve/reject are explicit (not gesture-only); the affirmative (approve) is the default
 * focus, never the destructive reject. The surface is an assertive live region so its
 * appearance is announced. All copy is i18n-sourced; nsec/key material never reaches a label
 * or log.
 *
 * Issue #1 usability fixes for large events (e.g. a kind:3 contact list with hundreds of tags):
 *  - the headline is the PLAIN-LANGUAGE action derived from method/kind ("Update your follow
 *    list"), not a technical dump; the SR label announces the action, never the raw payload;
 *  - the monospace panel defaults to the BOUNDED summary; "View raw event" expands to the
 *    EXACT untruncated event, so SM-C3 exactness is preserved without forcing the scroll;
 *  - Approve/Reject live in a STICKY footer outside the ScrollView — always visible/reachable
 *    no matter how large the preview grows.
 *
 * The ApprovalCoordinator (this story's core) is the only module that PRESENTS this surface;
 * the coordinator hook drives announce + focus land/trap/restore across the FIFO drain.
 */
export const NostrRequestApprovalScreen: React.FC<Props> = ({
  clientName,
  clientImage,
  humanAction,
  method,
  eventKind,
  uHost,
  followListDelta,
  contentPreview,
  contentPreviewFull,
  index,
  total,
  onApprove,
  onReject,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrRequestApprovalScreen
  const [expanded, setExpanded] = useState(false)

  const action = nostrActionLabel(LL.NostrActionKind, {
    method,
    eventKind,
    uHost,
    fallback: humanAction,
    followDelta: followListDelta,
  })
  const hasFull =
    contentPreviewFull !== undefined && contentPreviewFull !== contentPreview
  const panelText = expanded && contentPreviewFull ? contentPreviewFull : contentPreview

  return (
    <View
      style={styles.root}
      testID="nostr-request-approval"
      accessible
      accessibilityLiveRegion="assertive"
      accessibilityLabel={T.srLabel({ client: clientName, action })}
    >
      <ScrollView contentContainerStyle={styles.container} testID="nostr-request-scroll">
        <Text
          type="p3"
          style={styles.counter}
          testID="nostr-request-counter"
          accessibilityLabel={T.announce({
            index,
            total,
            client: clientName,
            action,
          })}
        >
          {T.counter({ index, total, client: clientName })}
        </Text>

        {/* App-identity row: avatar (client `image`, or initial-in-circle) + name — mirrors the
            approval mock header so the user sees WHO is asking. */}
        <View style={styles.appRow}>
          <Avatar
            rounded
            size={44}
            {...(clientImage
              ? { source: { uri: clientImage } }
              : { title: (clientName || "?").charAt(0).toUpperCase() })}
            containerStyle={styles.avatar}
          />
          <Text type="p1" style={styles.clientName}>
            {clientName}
          </Text>
        </View>

        {/* Plain-language headline (issue #1): WHAT the client wants, not a technical dump. */}
        <Text type="h2" style={styles.title} testID="nostr-request-action">
          {capitalizeAction(action)}
        </Text>

        {/* Issue #2 mitigation: a kind:3 is a FULL replacement list — when the raise site could
            compare it to the published list and it would drop most follows, say so LOUDLY
            before the buttons. (Primal once built a 1-tag list from a stale fetch; the user
            approved the exact content and lost 685 follows.) */}
        {followListDelta && isDrasticFollowShrink(followListDelta) ? (
          <View style={styles.warningBanner} testID="nostr-request-follow-warning">
            <Text type="p3" style={styles.warningText}>
              {T.followShrinkWarning({
                before: followListDelta.before,
                after: followListDelta.after,
              })}
            </Text>
          </View>
        ) : null}

        {/* "What will be signed": the bounded summary by default; the EXACT content (SM-C3)
            expands below. Consequence copy never truncates silently — the expander always
            offers the full record. */}
        <Text type="p3" style={styles.panelLabel}>
          {T.whatWillBeSigned()}
        </Text>
        <View style={styles.panel}>
          <Text
            type="p2"
            style={styles.panelText}
            testID="nostr-request-content"
            selectable
          >
            {panelText}
          </Text>
        </View>
        {hasFull ? (
          <TouchableOpacity
            onPress={() => setExpanded((e) => !e)}
            testID="nostr-request-expand"
            accessibilityRole="button"
            accessibilityLabel={expanded ? T.hideRawEvent() : T.viewRawEvent()}
          >
            <Text type="p3" style={styles.expandText}>
              {expanded ? T.hideRawEvent() : T.viewRawEvent()}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {/* Sticky footer (issue #1): the decision is always reachable — the panel scrolls, the
          buttons never move. Affirmative (approve) is the default focus target; reject is
          never default. The coordinator hook calls AccessibilityInfo.setAccessibilityFocus on
          the marked view. */}
      <View style={styles.footer} testID="nostr-request-footer">
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
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  root: {
    flex: 1,
  },
  container: {
    padding: 20,
    rowGap: 14,
  },
  counter: {
    color: colors.grey1,
  },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  avatar: {
    backgroundColor: colors.grey4,
  },
  clientName: {
    flexShrink: 1,
    fontWeight: "600",
    color: colors.black,
  },
  title: {
    color: colors.black,
  },
  panelLabel: {
    color: colors.grey2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  panel: {
    backgroundColor: colors.grey5,
    borderRadius: 8,
    padding: 14,
  },
  panelText: {
    color: colors.grey0,
    fontFamily: "monospace",
  },
  expandText: {
    color: colors.primary,
    fontWeight: "600",
    textAlign: "center",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.grey5,
    padding: 20,
    rowGap: 10,
  },
  warningBanner: {
    backgroundColor: colors.error9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: 12,
  },
  warningText: {
    color: colors.black,
    fontWeight: "600",
  },
}))
