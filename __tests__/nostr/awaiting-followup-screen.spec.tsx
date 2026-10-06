/**
 * Sign-in waiting screen — renders the reworded copy ("Waiting for sign-in challenge from app…")
 * plus the second-approval hint, the spinner, and the client identity (avatar + name). Copy is
 * i18n; asserted via testIDs (the harness does not reliably match interpolation-free i18n text).
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrAwaitingFollowupScreen } from "@app/screens/nostr/awaiting-followup-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrAwaitingFollowupScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrAwaitingFollowupScreen
        clientName="BTCPay Server"
        onCancel={() => {}}
        {...props}
      />
    </ContextForScreen>,
  )

describe("awaiting-followup screen", () => {
  it("renders the spinner, body copy, hint, and client name", async () => {
    const { getByTestId, getByText } = renderScreen()
    await flushEffects()
    expect(getByTestId("nostr-awaiting-spinner")).toBeTruthy()
    expect(getByTestId("nostr-awaiting-body")).toBeTruthy()
    expect(getByTestId("nostr-awaiting-hint")).toBeTruthy()
    expect(getByText("BTCPay Server")).toBeTruthy() // client name is a raw prop
  })

  /** The same-device mobile flow can strand the user on this spinner (the client app is
   *  backgrounded and never sends its challenge), so the escape hatch must always exist. */
  it("renders a cancel control that invokes onCancel", async () => {
    const onCancel = jest.fn()
    const { getByTestId } = renderScreen({ onCancel })
    await flushEffects()

    const cancel = getByTestId("nostr-awaiting-cancel")
    expect(cancel).toBeTruthy()

    fireEvent.press(cancel)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
