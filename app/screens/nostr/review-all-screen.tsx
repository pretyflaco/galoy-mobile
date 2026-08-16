import React, { useMemo, useState } from "react"
import { TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

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
    <View style={styles.container} testID="nostr-review-all">
      <Text type="h2" style={styles.title}>
        {T.title()}
      </Text>

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
            <Text type="p3" style={styles.action}>
              {item.action}
            </Text>
            <Text
              type="p2"
              style={styles.preview}
              testID={`nostr-review-preview-${item.id}`}
            >
              {item.preview}
            </Text>
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
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    padding: 24,
    rowGap: 12,
  },
  title: {
    color: colors.black,
  },
  row: {
    paddingVertical: 8,
    rowGap: 2,
  },
  action: {
    color: colors.grey1,
  },
  preview: {
    color: colors.black,
  },
  footer: {
    color: colors.grey2,
    marginTop: 8,
  },
}))
