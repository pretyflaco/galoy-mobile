import React, { useMemo, useState } from "react"
import { ScrollView, TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { createReviewAllSelection } from "@app/nostr/approval/review-all"

export interface ReviewAllItem {
  id: string
  /** Human-meaning action (never raw scope/kind). */
  action: string
  /** The rendered content preview — always shown before a row can be approved (SM-C3). */
  preview: string
}

type Props = {
  clientName: string
  items: ReviewAllItem[]
  onApproveSelected: (ids: string[]) => void
  onRejectSelected: (ids: string[]) => void
}

/**
 * "Review all" burst surface (Story 3.6 / Flow 4 / SM-C3). Expands the serialized queue into a
 * list where EACH row renders its content (op + preview) and is an AT-selectable checkbox with
 * an announced state. Selection drives ONE batched "Approve N" action over the VISIBLE rendered
 * rows only — there is deliberately NO "approve all remaining" blanket control. The footer
 * states it plainly. All copy is i18n-sourced; plaintext never leaves the surface.
 */
export const NostrReviewAllScreen: React.FC<Props> = ({
  clientName,
  items,
  onApproveSelected,
  onRejectSelected,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrReviewAllScreen
  const selection = useMemo(
    () => createReviewAllSelection(items.map((i) => i.id)),
    [items],
  )
  // Re-render tick so the selection model's changes reflect in the UI.
  const [, setTick] = useState(0)
  const rerender = () => setTick((t) => t + 1)

  const toggle = (id: string) => {
    selection.toggle(id)
    rerender()
  }

  const count = selection.count()

  return (
    <ScrollView contentContainerStyle={styles.container} testID="nostr-review-all">
      <View style={styles.header}>
        <Text type="h2" style={styles.title}>
          {T.title()}
        </Text>
        {/* Counter chip: how many requests are in this burst (mirrors the modal-burst mock). */}
        <View style={styles.counterChip}>
          <Text type="p4" style={styles.counterChipText} testID="nostr-review-counter">
            {T.reviewAll({ total: items.length })}
          </Text>
        </View>
      </View>

      {items.map((item) => {
        const checked = selection.isSelected(item.id)
        return (
          <TouchableOpacity
            key={item.id}
            testID={`nostr-review-row-${item.id}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={T.rowA11y({ action: item.action, preview: item.preview })}
            onPress={() => toggle(item.id)}
            style={styles.row}
          >
            {/* Visible checkbox glyph reflecting the selected state (was a11y-only before). */}
            <View
              style={[styles.checkbox, checked && styles.checkboxOn]}
              testID={`nostr-review-checkbox-${item.id}`}
            >
              {checked ? (
                <GaloyIcon name="check" size={16} color={styles.checkOn.color} />
              ) : null}
            </View>
            <View style={styles.rowMain}>
              <Text type="p3" style={styles.action}>
                {item.action}
              </Text>
              <Text
                type="p2"
                style={styles.preview}
                numberOfLines={2}
                testID={`nostr-review-preview-${item.id}`}
              >
                {item.preview}
              </Text>
            </View>
          </TouchableOpacity>
        )
      })}

      <GaloyPrimaryButton
        title={T.approveSelected({ count })}
        onPress={() => onApproveSelected(selection.selected())}
        testID="nostr-review-approve-selected"
        accessibilityLabel={T.approveSelectedA11y({ count, client: clientName })}
      />
      <GaloySecondaryButton
        title={T.rejectSelected({ count })}
        onPress={() => onRejectSelected(selection.selected())}
        testID="nostr-review-reject-selected"
      />

      <Text type="p3" style={styles.footer}>
        {T.footer()}
      </Text>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    padding: 24,
    rowGap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 10,
  },
  title: {
    color: colors.black,
  },
  counterChip: {
    backgroundColor: colors.grey5,
    borderColor: colors.grey4,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 12,
  },
  counterChipText: {
    color: colors.grey0,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.grey2,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkOn: {
    color: colors.white,
  },
  rowMain: {
    flex: 1,
    rowGap: 2,
  },
  action: {
    color: colors.grey1,
    fontWeight: "600",
  },
  preview: {
    color: colors.black,
  },
  footer: {
    color: colors.grey2,
    marginTop: 8,
  },
}))
