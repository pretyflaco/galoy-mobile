import React from "react"
import { fireEvent, render, waitFor } from "@testing-library/react-native"

import { LnurlDomain } from "@app/self-custodial/config"

/** Two modes under test: PRIMARY (no existing address on another domain) registers via
 *  the SDK and persists the chosen domain; SECONDARY (account already holds an address
 *  on the other domain) must NOT touch the stored domain — it registers via signed REST
 *  against the target server and stores the address in the alt slot. Both end on the
 *  success screen. */

const mockNavigate = jest.fn()
const mockReplace = jest.fn()
const mockGoBack = jest.fn()
let mockRouteDomain: LnurlDomain = LnurlDomain.BlinkSv
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    goBack: mockGoBack,
  }),
  useRoute: () => ({ params: { domain: mockRouteDomain } }),
}))

const mockReloadAccounts = jest.fn()
let mockActiveEntry: Record<string, unknown> | null = null
jest.mock("@app/hooks/use-account-registry", () => ({
  /** ContextForScreen mounts the real AccountRegistryProvider from this module; keep it
   *  and override only the hook the screen reads. */
  ...jest.requireActual("@app/hooks/use-account-registry"),
  useAccountRegistry: () => ({
    activeAccount: { id: "sc-1", type: "self-custodial" },
    selfCustodialEntries: mockActiveEntry ? [mockActiveEntry] : [],
    reloadSelfCustodialAccounts: mockReloadAccounts,
  }),
}))

const mockSdk = { stub: true }
const mockUpdateCurrent = jest.fn()
/** The SDK's connected lnurl domain: matches the route in primary mode, stays on the
 *  account's primary domain in secondary mode. */
let mockConnectedDomain = "blink.sv"
jest.mock("@app/self-custodial/providers/wallet", () => ({
  useSelfCustodialWallet: () => ({
    sdk: mockSdk,
    status: "ready",
    connectedAccountId: "sc-1",
    connectedLnurlDomain: mockConnectedDomain,
    updateCurrentSelfCustodialAccount: mockUpdateCurrent,
  }),
}))

jest.mock("@app/self-custodial/providers/backup-state", () => ({
  BackupStatus: { None: "none", Pending: "pending", Completed: "completed" },
  useBackupState: () => ({ backupState: { status: "completed", method: "manual" } }),
}))

import { Network } from "@breeztech/breez-sdk-spark-react-native"

jest.mock("@app/self-custodial/hooks/use-spark-network", () => ({
  useSparkNetwork: () => Network.Mainnet,
}))

jest.mock("@app/hooks/use-in-flight-guard", () => ({
  useInFlightGuard: () => ({ run: (fn: () => Promise<void>) => fn() }),
}))

const mockCheckSdk = jest.fn()
const mockRegisterSdk = jest.fn()
const mockSign = jest.fn(async (_sdk: unknown, _message: string) => ({ pubkey: "02ab", signature: "deadbeef" }))
jest.mock("@app/self-custodial/bridge", () => ({
  ...jest.requireActual("@app/self-custodial/bridge"),
  checkLightningAddressAvailable: (...args: unknown[]) => mockCheckSdk(...args),
  registerLightningAddress: (...args: unknown[]) => mockRegisterSdk(...args),
  signMessageWithIdentityKey: (sdk: unknown, message: string) => mockSign(sdk, message),
}))

const mockCheckRest = jest.fn()
const mockRegisterRest = jest.fn()
jest.mock("@app/self-custodial/lnurl-register", () => ({
  ...jest.requireActual("@app/self-custodial/lnurl-register"),
  checkAddressAvailableOnDomain: (...args: unknown[]) => mockCheckRest(...args),
  registerAddressOnDomain: (...args: unknown[]) => mockRegisterRest(...args),
}))

const mockSetDomain = jest.fn(async (_id: string, _domain: string) => undefined)
const mockSetAlt = jest.fn(async (_id: string, _address: string | null) => undefined)
jest.mock("@app/self-custodial/storage/account-index", () => ({
  ...jest.requireActual("@app/self-custodial/storage/account-index"),
  setSelfCustodialLnurlDomain: (id: string, domain: string) => mockSetDomain(id, domain),
  setSelfCustodialAltLightningAddress: (id: string, address: string | null) =>
    mockSetAlt(id, address),
}))

import { SetSelfCustodialAddressScreen } from "@app/screens/self-custodial/onboarding/set-address-screen"

import { ContextForScreen } from "../../helper"

const renderScreen = () =>
  render(
    <ContextForScreen>
      <SetSelfCustodialAddressScreen />
    </ContextForScreen>,
  )

const fillAndSubmit = (utils: ReturnType<typeof renderScreen>, username: string) => {
  fireEvent.changeText(utils.getByTestId("set-self-custodial-address-input"), username)
  fireEvent.press(utils.getByTestId("set-self-custodial-address-submit"))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockActiveEntry = null
  mockRouteDomain = LnurlDomain.BlinkSv
  mockConnectedDomain = "blink.sv"
  mockCheckSdk.mockResolvedValue(true)
  mockCheckRest.mockResolvedValue(true)
  mockRegisterRest.mockResolvedValue("alice@blink.sv")
})

describe("SetSelfCustodialAddressScreen (primary mode)", () => {
  it("persists the chosen domain up front and registers via the SDK", async () => {
    const utils = renderScreen()

    await waitFor(() => expect(mockSetDomain).toHaveBeenCalledWith("sc-1", "blink.sv"))

    fillAndSubmit(utils, "alice")

    await waitFor(() =>
      expect(mockRegisterSdk).toHaveBeenCalledWith(mockSdk, "alice"),
    )
    expect(mockRegisterRest).not.toHaveBeenCalled()
    expect(mockSetAlt).not.toHaveBeenCalled()
  })

  it("lands on the success screen (not goBack) after registering", async () => {
    const utils = renderScreen()

    fillAndSubmit(utils, "alice")

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("selfCustodialAddressSuccess", {
        address: "alice@blink.sv",
      }),
    )
    expect(mockGoBack).not.toHaveBeenCalled()
  })
})

describe("SetSelfCustodialAddressScreen (secondary mode)", () => {
  beforeEach(() => {
    /** The account's primary sits on twentyone.ist; claiming blink.sv must not
     *  reconnect the SDK. */
    mockActiveEntry = { id: "sc-1", lightningAddress: "alice@twentyone.ist" }
    mockConnectedDomain = "twentyone.ist"
  })

  it("never touches the stored domain — the SDK stays bound to the primary server", async () => {
    renderScreen()

    await waitFor(() => expect(mockSetDomain).not.toHaveBeenCalled())
  })

  it("registers via signed REST and stores the address in the alt slot", async () => {
    const utils = renderScreen()

    fillAndSubmit(utils, "alice")

    await waitFor(() =>
      expect(mockRegisterRest).toHaveBeenCalledWith(
        expect.objectContaining({ base: "https://blink.sv", username: "alice" }),
      ),
    )
    expect(mockSetAlt).toHaveBeenCalledWith("sc-1", "alice@blink.sv")
    expect(mockRegisterSdk).not.toHaveBeenCalled()
    expect(mockUpdateCurrent).not.toHaveBeenCalled()
  })

  it("lands on the success screen with the server-confirmed address", async () => {
    const utils = renderScreen()

    fillAndSubmit(utils, "alice")

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("selfCustodialAddressSuccess", {
        address: "alice@blink.sv",
      }),
    )
  })

  it("reports a taken address without throwing", async () => {
    mockCheckRest.mockResolvedValue(false)
    const utils = renderScreen()

    fillAndSubmit(utils, "alice")

    await waitFor(() => expect(mockRegisterRest).not.toHaveBeenCalled())
    expect(mockSetAlt).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
