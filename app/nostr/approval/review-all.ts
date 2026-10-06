/**
 * "Review all" multi-select selection model (Story 3.6 / Task 3/4 / SM-C3).
 *
 * The Review-all list expands the serialized queue into rows; each row renders its own content
 * (op + content preview) and is individually selectable. Selection drives ONE batched
 * "Approve N" action over the VISIBLE rendered rows only — there is deliberately NO blanket
 * "approve all remaining" that hides content. The batch-approve count recomputes on every
 * selection change so the accessible label can enumerate it.
 *
 * AD-1: this module is UI-free (pure selection state).
 */

export interface ReviewAllSelection {
  toggle(rowId: string): void
  isSelected(rowId: string): boolean
  /** Selected row ids in row order. */
  selected(): string[]
  count(): number
}

export const createReviewAllSelection = (rowIds: string[]): ReviewAllSelection => {
  const order = rowIds
  const set = new Set<string>()

  return {
    toggle(rowId: string): void {
      // Only visible rows are selectable — a toggle for an unknown id is a no-op.
      if (!order.includes(rowId)) return
      if (set.has(rowId)) set.delete(rowId)
      else set.add(rowId)
    },
    isSelected(rowId: string): boolean {
      return set.has(rowId)
    },
    selected(): string[] {
      return order.filter((id) => set.has(id))
    },
    count(): number {
      return set.size
    },
  }
}

/**
 * The recomputed accessible label for the batched Approve control. It ENUMERATES the current
 * count and the client so a non-visual user always hears the scope of the batch action.
 */
export const approveLabelCount = (
  selection: ReviewAllSelection,
  client: string,
): string => `Approve ${selection.count()} selected requests from ${client}`
