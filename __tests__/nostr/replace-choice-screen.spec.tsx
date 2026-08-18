/**
 * Replace-identity choice (2D) — import an existing key OR create a brand-new one, both of which
 * discard the current key. Import routes straight out (its own flow re-consents). "Create a new
 * identity" is destructive with NO downstream gate (core `confirmCreate` overwrites
 * unconditionally), so this screen shows a {consent-danger} confirmation FIRST — Cancel returns to
 * the choice, and only the explicit confirm enters the create ceremony. Asserted by testID.
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrReplaceChoiceScreen } from "@app/screens/nostr/settings/replace-choice-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrReplaceChoiceScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrReplaceChoiceScreen onImport={jest.fn()} onCreateNew={jest.fn()} {...props} />
    </ContextForScreen>,
  )

describe("Replace-identity choice (2D)", () => {
  it("offers import and create-new options", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    expect(getByTestId("nostr-replace-choice")).toBeTruthy()
    expect(getByTestId("nostr-replace-import")).toBeTruthy()
    expect(getByTestId("nostr-replace-create")).toBeTruthy()
  })

  it("routes import immediately without any consent gate", async () => {
    const onImport = jest.fn()
    const onCreateNew = jest.fn()
    const { getByTestId } = renderScreen({ onImport, onCreateNew })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-replace-import"))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it("does NOT create on the first create tap — it shows the destructive consent card", async () => {
    const onCreateNew = jest.fn()
    const { getByTestId, queryByTestId } = renderScreen({ onCreateNew })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-replace-create"))
    expect(getByTestId("nostr-replace-create-confirm")).toBeTruthy()
    expect(onCreateNew).not.toHaveBeenCalled()
    // The choice buttons are gone while confirming.
    expect(queryByTestId("nostr-replace-choice")).toBeNull()
  })

  it("cancel from the consent card returns to the choice without creating", async () => {
    const onCreateNew = jest.fn()
    const { getByTestId } = renderScreen({ onCreateNew })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-replace-create"))
    fireEvent.press(getByTestId("nostr-replace-create-cancel"))
    expect(getByTestId("nostr-replace-choice")).toBeTruthy()
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it("only enters the create ceremony after the explicit destructive confirm", async () => {
    const onCreateNew = jest.fn()
    const { getByTestId } = renderScreen({ onCreateNew })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-replace-create"))
    fireEvent.press(getByTestId("nostr-replace-create-confirm-yes"))
    expect(onCreateNew).toHaveBeenCalledTimes(1)
  })
})
