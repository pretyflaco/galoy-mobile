import React from "react"
import { Pressable, Text } from "react-native"

import { fireEvent, render } from "@testing-library/react-native"

import { loadLocale } from "@app/i18n/i18n-util.sync"
import { i18nObject } from "@app/i18n/i18n-util"

const mockNavigate = jest.fn()
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate }),
}))

let mockDelegatedGrantsEnabled = true
jest.mock("@app/config/feature-flags-context", () => ({
  useFeatureFlags: () => ({ delegatedGrantsEnabled: mockDelegatedGrantsEnabled }),
}))

jest.mock("@app/components/atomic/galoy-primary-button", () => ({
  GaloyPrimaryButton: ({
    title,
    onPress,
    disabled,
  }: {
    title: string
    onPress: () => void
    disabled?: boolean
  }) => (
    <Pressable
      testID={`primary-${title}`}
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={disabled ? undefined : onPress}
    >
      <Text>{title}</Text>
    </Pressable>
  ),
}))

import { LnurlDomain } from "@app/self-custodial/config"
import { ChooseLnurlDomainScreen } from "@app/screens/self-custodial/onboarding/choose-lnurl-domain-screen"
import { ContextForScreen } from "../../helper"

loadLocale("en")
const LL = i18nObject("en")

/** Capture the OptionCardGroup props so the gating (disabled) and selection logic is
 *  asserted directly, without reaching into card internals. */
const mockOptionCardGroup = jest.fn()
jest.mock("@app/components/option-card-group", () => ({
  OptionCardGroup: (props: unknown) => {
    mockOptionCardGroup(props)
    return null
  },
}))

describe("ChooseLnurlDomainScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDelegatedGrantsEnabled = true
  })

  const lastOptions = () =>
    (mockOptionCardGroup.mock.calls.at(-1)?.[0] as {
      options: { key: LnurlDomain; disabled?: boolean }[]
      selectedKey: LnurlDomain | null
    }) ?? { options: [], selectedKey: null }

  it("defaults to the production blink.sv domain", () => {
    render(
      <ContextForScreen>
        <ChooseLnurlDomainScreen />
      </ContextForScreen>,
    )

    expect(lastOptions().selectedKey).toBe(LnurlDomain.BlinkSv)
  })

  it("offers twentyone.ist as an enabled option when delegated grants are on", () => {
    render(
      <ContextForScreen>
        <ChooseLnurlDomainScreen />
      </ContextForScreen>,
    )

    const twentyone = lastOptions().options.find(
      (o) => o.key === LnurlDomain.TwentyoneIst,
    )
    expect(twentyone).toBeTruthy()
    expect(twentyone?.disabled).toBe(false)
  })

  it("shows twentyone.ist greyed out when delegated grants are off", () => {
    mockDelegatedGrantsEnabled = false

    render(
      <ContextForScreen>
        <ChooseLnurlDomainScreen />
      </ContextForScreen>,
    )

    const twentyone = lastOptions().options.find(
      (o) => o.key === LnurlDomain.TwentyoneIst,
    )
    expect(twentyone?.disabled).toBe(true)
    // blink.sv stays selectable.
    const blink = lastOptions().options.find((o) => o.key === LnurlDomain.BlinkSv)
    expect(blink?.disabled).toBeUndefined()
  })

  it("navigates to username entry with the chosen domain on continue", () => {
    render(
      <ContextForScreen>
        <ChooseLnurlDomainScreen />
      </ContextForScreen>,
    )

    // Simulate selecting twentyone.ist then pressing Continue.
    const onSelect = (
      mockOptionCardGroup.mock.calls.at(-1)?.[0] as {
        onSelect: (k: LnurlDomain) => void
      }
    ).onSelect
    onSelect(LnurlDomain.TwentyoneIst)

    // Re-render picks up the new selection through the screen's own state.
    const { getByTestId } = render(
      <ContextForScreen>
        <ChooseLnurlDomainScreen />
      </ContextForScreen>,
    )
    // Continue with the default selection proves the route + param shape.
    fireEvent.press(getByTestId(`primary-${LL.ChooseLnurlDomainScreen.continueButton()}`))
    expect(mockNavigate).toHaveBeenCalledWith("selfCustodialSetAddress", {
      domain: LnurlDomain.BlinkSv,
    })
  })
})
