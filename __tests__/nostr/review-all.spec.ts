/**
 * Story 3.6 Task 3/4 — "Review all" multi-select selection model.
 *
 * The Review-all list expands the queue; each row renders its content (op + preview) and is
 * multi-selectable → ONE batched "Approve N" action. There is NO blanket "approve all
 * remaining" that hides content — batching is over VISIBLE rendered rows only (SM-C3). The
 * batch-approve count RECOMPUTES on every selection change (a11y label enumerates it).
 */
import {
  createReviewAllSelection,
  approveLabelCount,
} from "../../app/nostr/approval/review-all"

const rows = ["a", "b", "c", "d"]

describe("Review-all selection model (Task 3/4)", () => {
  it("starts with nothing selected", () => {
    const sel = createReviewAllSelection(rows)
    expect(sel.selected()).toEqual([])
    expect(sel.count()).toBe(0)
  })

  it("toggles a row on and off", () => {
    const sel = createReviewAllSelection(rows)
    sel.toggle("b")
    expect(sel.isSelected("b")).toBe(true)
    expect(sel.selected()).toEqual(["b"])
    sel.toggle("b")
    expect(sel.isSelected("b")).toBe(false)
    expect(sel.count()).toBe(0)
  })

  it("selects multiple and reports them in row order", () => {
    const sel = createReviewAllSelection(rows)
    sel.toggle("c")
    sel.toggle("a")
    expect(sel.selected()).toEqual(["a", "c"]) // row order preserved
    expect(sel.count()).toBe(2)
  })

  it("the batched approve count RECOMPUTES on every selection change", () => {
    const sel = createReviewAllSelection(rows)
    expect(approveLabelCount(sel, "Damus")).toBe("Approve 0 selected requests from Damus")
    sel.toggle("a")
    expect(approveLabelCount(sel, "Damus")).toBe("Approve 1 selected requests from Damus")
    sel.toggle("b")
    expect(approveLabelCount(sel, "Damus")).toBe("Approve 2 selected requests from Damus")
  })

  it("ignores a toggle for an unknown row id (only visible rows are selectable)", () => {
    const sel = createReviewAllSelection(rows)
    sel.toggle("zzz")
    expect(sel.count()).toBe(0)
  })
})
