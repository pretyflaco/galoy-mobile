/**
 * Story 3.3 Task 11 — connection-approval screen (native rne-theme) + a11y (AC #1/#3, UX).
 *
 * The surface names the client, states the grant in HUMAN MEANING ONLY (no raw scope), and
 * offers Approve / Reject via explicit controls (not gesture-only). Behavior is asserted via
 * testIDs (the ContextForScreen harness renders i18n copy empty); i18n-sourcing + the SR label
 * pattern are enforced by a separate source-scan test.
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrConnectionApprovalScreen } from "@app/screens/nostr/connection-approval-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrConnectionApprovalScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrConnectionApprovalScreen
        clientName="Damus"
        onApprove={jest.fn()}
        onReject={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("connection-approval screen (AC #1/#3)", () => {
  it("renders explicit approve and reject controls (not gesture-only)", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    expect(getByTestId("nostr-connection-approve")).toBeTruthy()
    expect(getByTestId("nostr-connection-reject")).toBeTruthy()
  })

  it("invokes onApprove / onReject on the respective controls", async () => {
    const onApprove = jest.fn()
    const onReject = jest.fn()
    const { getByTestId } = renderScreen({ onApprove, onReject })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-connection-approve"))
    fireEvent.press(getByTestId("nostr-connection-reject"))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it("the surface is an accessible element with a wired accessibilityLabel", async () => {
    // The ContextForScreen harness loads i18n async so copy is empty in tests; assert the
    // a11y wiring here and enforce the label CONTENT (client name, no raw scope) in the
    // source-scan test (connection-approval-i18n.spec.ts).
    const { getByTestId } = renderScreen({ clientName: "Damus" })
    await flushEffects()
    const surface = getByTestId("nostr-connection-approval")
    expect(surface.props.accessible).toBe(true)
    expect(surface.props).toHaveProperty("accessibilityLabel")
  })
})
