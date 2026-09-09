/**
 * Replace your identity (redesign r3, spec §7.10) — the destructive warning IS the screen
 * content (shown on open, no hidden consent step): "Create new" follows the same routing as
 * first-run creation, "Import existing" routes to the import flow. Back aborts; the current
 * identity is unchanged until a replacement commits. Asserted by testID.
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

describe("Replace your identity (r3)", () => {
  it("shows the destructive warning up front with Create new + Import existing options", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    expect(getByTestId("nostr-replace-choice")).toBeTruthy()
    expect(getByTestId("nostr-replace-create")).toBeTruthy()
    expect(getByTestId("nostr-replace-import")).toBeTruthy()
  })

  it("Create new enters the create flow directly (first-run routing, no extra gate)", async () => {
    const onCreateNew = jest.fn()
    const onImport = jest.fn()
    const { getByTestId } = renderScreen({ onCreateNew, onImport })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-replace-create"))
    expect(onCreateNew).toHaveBeenCalledTimes(1)
    expect(onImport).not.toHaveBeenCalled()
  })

  it("Import existing routes to the import flow", async () => {
    const onImport = jest.fn()
    const onCreateNew = jest.fn()
    const { getByTestId } = renderScreen({ onImport, onCreateNew })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-replace-import"))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onCreateNew).not.toHaveBeenCalled()
  })
})
