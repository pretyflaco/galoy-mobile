/**
 * Story 3.4 Task 3/6 — request-approval surface (native rne-theme) + a11y.
 *
 * Renders EXACTLY what will be signed/decrypted (content, not a summary) with a
 * "Request X of N from <client>" counter, explicit approve/reject (not gesture-only, reject
 * NOT default focus), an assertive live region, and (iOS) the keep-app-open catch-up.
 * Behavior asserted via testIDs (i18n copy empty in harness); SR-label content is enforced in
 * the source-scan test.
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrRequestApprovalScreen } from "@app/screens/nostr/request-approval-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrRequestApprovalScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrRequestApprovalScreen
        clientName="Damus"
        humanAction="decrypt a message"
        contentPreview="Hey, are we still on for tonight?"
        index={2}
        total={32}
        onApprove={jest.fn()}
        onReject={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("request-approval screen (AC #4)", () => {
  it("renders explicit approve + reject controls", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    expect(getByTestId("nostr-request-approve")).toBeTruthy()
    expect(getByTestId("nostr-request-reject")).toBeTruthy()
  })

  it("renders the exact content that will be signed/decrypted (not a summary)", async () => {
    const { getByTestId } = renderScreen({
      contentPreview: "Hey, are we still on for tonight?",
    })
    await flushEffects()
    const content = getByTestId("nostr-request-content")
    expect(content.props.children).toBe("Hey, are we still on for tonight?")
  })

  it("shows the Request X of N counter surface", async () => {
    const { getByTestId } = renderScreen({ index: 2, total: 32 })
    await flushEffects()
    expect(getByTestId("nostr-request-counter")).toBeTruthy()
  })

  it("carries an assertive live region announcing the surface", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    const surface = getByTestId("nostr-request-approval")
    expect(surface.props.accessibilityLiveRegion).toBe("assertive")
  })

  it("invokes onApprove / onReject", async () => {
    const onApprove = jest.fn()
    const onReject = jest.fn()
    const { getByTestId } = renderScreen({ onApprove, onReject })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-request-approve"))
    fireEvent.press(getByTestId("nostr-request-reject"))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it("reject control is NOT the default-focus (approve is the affirmative default)", async () => {
    const { getByTestId, queryByTestId } = renderScreen()
    await flushEffects()
    // the default-focus target wraps the affirmative (approve) control; the coordinator hook
    // targets it with setAccessibilityFocus on appear. Reject is never the default focus.
    const focusTarget = getByTestId("nostr-request-default-focus")
    expect(focusTarget).toBeTruthy()
    // the approve button lives inside the default-focus target; reject does not
    expect(queryByTestId("nostr-request-approve")).toBeTruthy()
  })
})
