/**
 * Story A2 — Nostr Identity settings row (self-gating entry point).
 *
 * The row renders ONLY when nostrSignerEnabled is on (AD-13): flag OFF ⇒ the signer is
 * invisible (renders null), leaving the settings screen untouched (NFR-9). Flag ON ⇒ the row
 * navigates to the "nostrIdentity" hub. Rendered under a MINIMAL i18n wrapper (not the full
 * navigation harness) so the flag-OFF null render is observable; the SettingsRow applies
 * testProps(title), so the row is addressable by its resolved title.
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

const useFeatureFlags = jest.fn()
jest.mock("@app/config/feature-flags-context", () => ({
  useFeatureFlags: () => useFeatureFlags(),
}))

const navigate = jest.fn()
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate }),
}))

import { createTheme, ThemeProvider } from "@rn-vui/themed"

import TypesafeI18n from "@app/i18n/i18n-react"
import { loadLocale } from "@app/i18n/i18n-util.sync"
import { NostrIdentitySetting } from "@app/screens/settings-screen/settings/nostr-identity"

loadLocale("en")
const theme = createTheme({})

const renderRow = () =>
  render(
    <ThemeProvider theme={theme}>
      <TypesafeI18n locale="en">
        <NostrIdentitySetting />
      </TypesafeI18n>
    </ThemeProvider>,
  )

beforeEach(() => {
  navigate.mockClear()
})

describe("Nostr Identity settings row (A2)", () => {
  it("renders NOTHING when the signer flag is OFF (invisible + inert, NFR-9)", () => {
    useFeatureFlags.mockReturnValue({ nostrSignerEnabled: false })
    const { toJSON } = renderRow()
    expect(toJSON()).toBeNull()
  })

  it("renders a row and navigates to the identity hub when the flag is ON", () => {
    useFeatureFlags.mockReturnValue({ nostrSignerEnabled: true })
    const { getByTestId } = renderRow()
    fireEvent.press(getByTestId("Nostr identity"))
    expect(navigate).toHaveBeenCalledWith("nostrIdentity")
  })
})
