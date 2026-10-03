/**
 * Nostr settings hub (2C) — groups "Back up your key" and "Replace your identity" behind a single
 * Settings entry off the Identity hub. Navigation-agnostic: routing is via injected callbacks,
 * asserted by testID.
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrSettingsScreen } from "@app/screens/nostr/settings/nostr-settings-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrSettingsScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrSettingsScreen
        onBackup={jest.fn()}
        onReplace={jest.fn()}
        backupStatus={null}
        {...props}
      />
    </ContextForScreen>,
  )

describe("Nostr settings hub (2C)", () => {
  it("renders the back-up and replace rows", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    expect(getByTestId("nostr-settings")).toBeTruthy()
    expect(getByTestId("nostr-settings-backup")).toBeTruthy()
    expect(getByTestId("nostr-settings-replace")).toBeTruthy()
  })

  it("routes back-up and replace", async () => {
    const onBackup = jest.fn()
    const onReplace = jest.fn()
    const { getByTestId } = renderScreen({ onBackup, onReplace })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-settings-backup"))
    fireEvent.press(getByTestId("nostr-settings-replace"))
    expect(onBackup).toHaveBeenCalledTimes(1)
    expect(onReplace).toHaveBeenCalledTimes(1)
  })
})
