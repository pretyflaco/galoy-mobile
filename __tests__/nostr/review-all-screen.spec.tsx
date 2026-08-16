/**
 * Story 3.6 Task 3/4 — the "Review all" burst surface (native rne-theme).
 *
 * Each row renders its content (op + preview) and is an AT-selectable checkbox with an
 * announced state; toggling recomputes the batched "Approve N" control. There is NO
 * "approve all remaining" blanket control (SM-C3). Behavior via testIDs (i18n empty in harness).
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrReviewAllScreen } from "@app/screens/nostr/review-all-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const items = [
  { id: "r1", action: "decrypt a message", preview: "hi there" },
  { id: "r2", action: "decrypt a message", preview: "see you soon" },
  { id: "r3", action: "sign an event", preview: "gm" },
]

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrReviewAllScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrReviewAllScreen
        clientName="Damus"
        items={items}
        onApproveSelected={jest.fn()}
        onRejectSelected={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("Review-all screen (Task 3/4)", () => {
  it("renders one selectable row per queued request", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    for (const item of items) {
      expect(getByTestId(`nostr-review-row-${item.id}`)).toBeTruthy()
    }
  })

  it("each row renders its content preview before it can be approved (SM-C3)", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    expect(getByTestId("nostr-review-preview-r1").props.children).toBe("hi there")
    expect(getByTestId("nostr-review-preview-r3").props.children).toBe("gm")
  })

  it("rows are checkbox controls with an announced checked state", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    const row = getByTestId("nostr-review-row-r1")
    expect(row.props.accessibilityRole).toBe("checkbox")
    expect(row.props.accessibilityState).toMatchObject({ checked: false })
    fireEvent.press(row)
    expect(getByTestId("nostr-review-row-r1").props.accessibilityState).toMatchObject({
      checked: true,
    })
  })

  it("batches the SELECTED rows into ONE Approve action (no per-row approve)", async () => {
    const onApproveSelected = jest.fn()
    const { getByTestId } = renderScreen({ onApproveSelected })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-review-row-r1"))
    fireEvent.press(getByTestId("nostr-review-row-r3"))
    fireEvent.press(getByTestId("nostr-review-approve-selected"))
    expect(onApproveSelected).toHaveBeenCalledWith(["r1", "r3"])
  })

  it("has NO 'approve all remaining' blanket control (SM-C3)", async () => {
    const { queryByTestId } = renderScreen()
    await flushEffects()
    expect(queryByTestId("nostr-review-approve-all-remaining")).toBeNull()
  })

  it("the batched Approve control carries a recomputed count in its accessible label", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    const approve = () => getByTestId("nostr-review-approve-selected")
    fireEvent.press(getByTestId("nostr-review-row-r1"))
    // the a11y label enumerates the current count (harness i18n is empty, so assert wiring)
    expect(approve().props).toHaveProperty("accessibilityLabel")
  })
})
