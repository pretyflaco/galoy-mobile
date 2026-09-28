import React, { useState } from "react"
import { ScrollView, TouchableOpacity, View } from "react-native"

import { Avatar, Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"

import {
  capitalizeAction,
  followShrinkWarningText,
  nostrActionLabel,
} from "./action-label"

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
  /**
   * For a kind:3 sign_event whose published-list read timed out / failed / found no list
   * (FR-25 fail-open, D4b): show a quiet "couldn't check" line. Never set for other kinds.
   */
  followListDeltaUnavailable?: boolean
  /** Bounded summary of the EXACT content (what is signed is unchanged). */
  contentPreview: string
  /** The EXACT untruncated content; when it differs from the summary, an expander is offered. */
  contentPreviewFull?: string
  index: number
  total: number
  onApprove: () => void
  onReject: () => void
  /**
   * The coordinator hook's focus ref (useApprovalCoordinator → setAccessibilityFocus on
   * appear). Attached to the DEFAULT-FOCUS view: the list-shrink warning while it shows
   * (FR-25 / D4 — Approve is then NOT the default), otherwise Approve. Never Reject.
   */
  defaultFocusRef?: React.Ref<View>
}

/**
 * Request-approval surface (Story 3.4 / SM-C3). Renders what will be signed/decrypted with a
 * "Request X of N from <client>" counter (the sighted mirror of the assertive announcement).
 * Approve/reject are explicit (not gesture-only); the affirmative (approve) is the default
 * focus, never the destructive reject — EXCEPT while the FR-25 list-shrink warning shows: then
 * the warning is the default focus, so assistive tech reads the consequence before any control. The surface is an assertive live region so its
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
  followListDeltaUnavailable,
  contentPreview,
  contentPreviewFull,
  index,
  total,
  onApprove,
  onReject,
  defaultFocusRef,
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
  // FR-25: the drastic-shrink sentence, carried by the banner, the SR label, and the announce.
  const shrinkWarning = followShrinkWarningText(T, followListDelta)
  const hasFull =
    contentPreviewFull !== undefined && contentPreviewFull !== contentPreview
  const panelText = expanded && contentPreviewFull ? contentPreviewFull : contentPreview

  return (
    <View
      style={styles.root}
      testID="nostr-request-approval"
      accessible
      accessibilityLiveRegion="assertive"
      accessibilityLabel={
        shrinkWarning
          ? T.srLabelWithWarning({ client: clientName, action, warning: shrinkWarning })
          : T.srLabel({ client: clientName, action })
      }
    >
      <ScrollView contentContainerStyle={styles.container} testID="nostr-request-scroll">
        <Text
          type="p3"
          style={styles.counter}
          testID="nostr-request-counter"
          accessibilityLabel={
            shrinkWarning
              ? T.announceWithWarning({
                  index,
                  total,
                  client: clientName,
                  action,
                  warning: shrinkWarning,
                })
              : T.announce({ index, total, client: clientName, action })
          }
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

        {/* FR-25 fail-open (D4b): the kind:3 read timed out / failed / found no list, so the
            headline is the plain one. Say so quietly — not an error, no banner, no alarm. */}
        {followListDeltaUnavailable && !followListDelta ? (
          <Text
            type="p3"
            style={styles.uncheckedHint}
            testID="nostr-request-follow-unchecked"
          >
            {T.followListUnchecked()}
          </Text>
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
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? T.hideRawEvent() : T.viewRawEvent()}
          >
            <Text type="p3" style={styles.expandText}>
              {expanded ? T.hideRawEvent() : T.viewRawEvent()}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {/* FR-25 list-shrink warning (issue #2): a kind:3 is a FULL replacement list — when the
          raise site could compare it to the published list and it would drop most follows,
          say so before the decision. Pinned directly above the footer (outside the scroll) so
          it can never scroll away, and read after the expander, before the controls (Story
          3.4 AT order). {consent-danger} on border + icon only, {consent-danger-bg} wash,
          consequence copy in grey0 — never red text (DESIGN list-shrink row).
          While it shows it is the DEFAULT FOCUS (D4): one accessible element carrying the
          warning, focused on appear, so AT reads the consequence before reaching Approve. It
          never blocks — Approve stays enabled (SM-C2). */}
      {shrinkWarning ? (
        <View
          ref={defaultFocusRef}
          testID="nostr-request-default-focus"
          accessible
          accessibilityLabel={shrinkWarning}
          collapsable={false}
        >
          <View style={styles.warningBanner} testID="nostr-request-follow-warning">
            <GaloyIcon name="warning" size={20} color={styles.warningIcon.color} />
            <Text
              type="p2"
              style={styles.warningText}
              testID="nostr-request-follow-warning-text"
            >
              {shrinkWarning}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Sticky footer (issue #1): the decision is always reachable — the panel scrolls, the
          buttons never move. Affirmative (approve) is the default focus target unless the
          shrink warning holds it; reject is never default. The coordinator hook calls
          AccessibilityInfo.setAccessibilityFocus on the view carrying defaultFocusRef. */}
      <View style={styles.footer} testID="nostr-request-footer">
        <View
          ref={shrinkWarning ? undefined : defaultFocusRef}
          testID={shrinkWarning ? undefined : "nostr-request-default-focus"}
          collapsable={false}
        >
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
  uncheckedHint: {
    color: colors.grey2, // de-emphasized helper copy — deliberately not an error colour
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
  // FR-25 list-shrink warning — an irreversible consent moment, so {consent-danger}, not
  // `warning` (DESIGN.md: that would mislabel it as recoverable).
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error, // {consent-danger} on border/icon ONLY
    backgroundColor: colors.error9, // {consent-danger-bg} wash
  },
  warningIcon: {
    color: colors.error, // {consent-danger}
  },
  warningText: {
    flexShrink: 1,
    color: colors.grey0, // consequence copy NEVER danger red (≥ 4.5:1 on the wash)
    fontWeight: "600",
  },
}))
