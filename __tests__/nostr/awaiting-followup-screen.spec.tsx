/**
 * Sign-in waiting screen — renders the reworded copy ("Waiting for sign-in challenge from app…")
 * plus the second-approval hint, the spinner, and the client identity (avatar + name). Copy is
 * i18n; asserted via testIDs (the harness does not reliably match interpolation-free i18n text).
 */
import React from "react"
import { render } from "@testing-library/react-native"

import { NostrAwaitingFollowupScreen } from "@app/screens/nostr/awaiting-followup-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrAwaitingFollowupScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrAwaitingFollowupScreen clientName="BTCPay Server" {...props} />
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
})
