/**
 * Duplicate-connection prompt (fix #4) — the re-login Replace / Keep both / Cancel surface.
 * Asserts each of the three controls fires its distinct handler (never gesture-only).
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrDuplicateConnectionScreen } from "@app/screens/nostr/duplicate-connection-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrDuplicateConnectionScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrDuplicateConnectionScreen
        clientName="Damus"
        onReplace={props.onReplace ?? jest.fn()}
        onKeepBoth={props.onKeepBoth ?? jest.fn()}
        onCancel={props.onCancel ?? jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("duplicate-connection prompt", () => {
  it("Replace fires onReplace", async () => {
    const onReplace = jest.fn()
    const { getByTestId } = renderScreen({ onReplace })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-duplicate-replace"))
    expect(onReplace).toHaveBeenCalledTimes(1)
  })

  it("Keep both fires onKeepBoth", async () => {
    const onKeepBoth = jest.fn()
    const { getByTestId } = renderScreen({ onKeepBoth })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-duplicate-keep-both"))
    expect(onKeepBoth).toHaveBeenCalledTimes(1)
  })

  it("Cancel fires onCancel", async () => {
    const onCancel = jest.fn()
    const { getByTestId } = renderScreen({ onCancel })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-duplicate-cancel"))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
