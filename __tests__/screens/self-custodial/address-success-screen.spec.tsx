import React from "react"
import { render, act, screen } from "@testing-library/react-native"

import { loadLocale } from "@app/i18n/i18n-util.sync"
import { i18nObject } from "@app/i18n/i18n-util"
import { AddressSuccessScreen } from "@app/screens/self-custodial/address-success-screen"

import { ContextForScreen } from "../helper"

const mockNavigate = jest.fn()
let mockRouteParams: { address: string } = { address: "alice@blink.sv" }

jest.mock("@react-navigation/native", () => {
  const actualNav = jest.requireActual("@react-navigation/native")
  return {
    ...actualNav,
    useNavigation: () => ({ navigate: mockNavigate }),
    useRoute: () => ({ params: mockRouteParams }),
  }
})

loadLocale("en")
const LL = i18nObject("en")

const SUCCESS_DELAY = 3000

describe("AddressSuccessScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    mockRouteParams = { address: "alice@blink.sv" }
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const renderScreen = async () => {
    const utils = render(
      <ContextForScreen>
        <AddressSuccessScreen />
      </ContextForScreen>,
    )
    await act(async () => {})
    return utils
  }

  it("confirms the registration with the new address", async () => {
    await renderScreen()

    expect(screen.getByText(LL.AddressSuccessScreen.title())).toBeTruthy()
    expect(screen.getByText("alice@blink.sv")).toBeTruthy()
  })

  /** The flow was entered from Settings via the domain/username screens: goBack would
   *  land on those, so the dismissal navigates to Settings explicitly. */
  it("navigates to Settings after the delay", async () => {
    await renderScreen()

    act(() => {
      jest.advanceTimersByTime(SUCCESS_DELAY)
    })

    expect(mockNavigate).toHaveBeenCalledWith("settings")
  })

  it("does not navigate before the delay elapses", async () => {
    await renderScreen()

    act(() => {
      jest.advanceTimersByTime(SUCCESS_DELAY - 1)
    })

    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
