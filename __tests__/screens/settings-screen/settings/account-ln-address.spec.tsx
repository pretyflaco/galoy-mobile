import React from "react"
import { act, render } from "@testing-library/react-native"

import { AccountType } from "@app/types/wallet"

const mockSettingsRow = jest.fn((_props: Record<string, unknown>) => null)
jest.mock("@app/screens/settings-screen/row", () => ({
  SettingsRow: mockSettingsRow,
}))

// Self-custodial registration is now a navigation flow (domain choice → username), so the
// row navigates instead of opening a modal. Capture the navigate call.
const mockNavigate = jest.fn()
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate }),
}))

// The row reads the address through this hook, not the wallet provider directly.
let mockScAddress: string | null = null
jest.mock(
  "@app/screens/settings-screen/settings/use-self-custodial-lightning-address",
  () => ({
    useSelfCustodialLightningAddress: () => mockScAddress,
  }),
)

const mockCustodialModal = jest.fn((_props: Record<string, unknown>) => null)
jest.mock("@app/components/set-lightning-address-modal", () => ({
  SetLightningAddressModal: mockCustodialModal,
}))

const mockBackupRequiredModal = jest.fn((_props: Record<string, unknown>) => null)
jest.mock("@app/components/backup-required-modal", () => ({
  BackupRequiredModal: mockBackupRequiredModal,
}))

let mockBackupStatus = "completed"
jest.mock("@app/self-custodial/providers/backup-state", () => ({
  BackupStatus: { None: "none", Pending: "pending", Completed: "completed" },
  useBackupState: () => ({ backupState: { status: mockBackupStatus, method: null } }),
}))

let mockIsAnonMode = false
jest.mock("@app/self-custodial/hooks/use-self-custodial-account-mode", () => ({
  useSelfCustodialAccountMode: () => ({ isAnonMode: mockIsAnonMode }),
}))

// The gate is domain-aware now; it has its own spec. Mock it at the seam so these tests
// pin the row's routing, not the gate's internals.
let mockIsLightningAddressGated = false
jest.mock("@app/self-custodial/hooks/use-lightning-address-gate", () => ({
  useLightningAddressGated: () => mockIsLightningAddressGated,
}))

jest.mock("@app/components/atomic/galoy-icon", () => ({
  GaloyIcon: () => null,
}))

const mockUseAccountRegistry = jest.fn()
jest.mock("@app/hooks/use-account-registry", () => ({
  useAccountRegistry: () => mockUseAccountRegistry(),
}))

const mockUseSelfCustodialWallet = jest.fn()
jest.mock("@app/self-custodial/providers/wallet", () => ({
  useSelfCustodialWallet: () => mockUseSelfCustodialWallet(),
}))

const mockCopyToClipboard = jest.fn()
jest.mock("@app/hooks", () => ({
  useAppConfig: () => ({
    appConfig: { galoyInstance: { lnAddressHostname: "blink.sv" } },
  }),
  useClipboard: () => ({ copyToClipboard: mockCopyToClipboard }),
}))

jest.mock("@app/graphql/is-authed-context", () => ({ useIsAuthed: () => true }))
const mockSettingsScreenQuery = jest.fn()
jest.mock("@app/graphql/generated", () => ({
  useSettingsScreenQuery: () => mockSettingsScreenQuery(),
}))

jest.mock("@rn-vui/themed", () => ({
  useTheme: () => ({ theme: { colors: { primary: "#fc5805" } } }),
}))

jest.mock("@app/i18n/i18n-react", () => ({
  useI18nContext: () => ({
    LL: {
      SettingsScreen: {
        createAddress: () => "Create address",
        addressDisabled: () => "(disabled)",
      },
      GaloyAddressScreen: { copiedLightningAddressToClipboard: () => "Copied" },
    },
  }),
}))

import { AccountLNAddress } from "@app/screens/settings-screen/settings/account-ln-address"

const lastRowProps = (): Record<string, unknown> =>
  (mockSettingsRow.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>

const SC_ADDRESS = "alice@staging.blink.sv"

describe("AccountLNAddress (self-custodial)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBackupStatus = "completed"
    mockIsAnonMode = false
    mockIsLightningAddressGated = false
    mockScAddress = null
    mockSettingsScreenQuery.mockReturnValue({ data: undefined, loading: false })
    mockUseAccountRegistry.mockReturnValue({
      activeAccount: { id: "sc-1", type: AccountType.SelfCustodial },
      selfCustodialEntries: [],
    })
  })

  it("prompts to create an address and navigates to the domain choice when none is registered", () => {
    mockScAddress = null

    render(<AccountLNAddress />)

    expect(lastRowProps().title).toBe("Create address")
    expect(lastRowProps().rightIcon).toBeUndefined()

    act(() => (lastRowProps().action as () => void)())

    expect(mockNavigate).toHaveBeenCalledWith("selfCustodialChooseLnurlDomain")
    expect(mockCopyToClipboard).not.toHaveBeenCalled()
  })

  /** Incognito cannot receive on blink.sv (dormant upstream), so the row says so beside
   *  the address it still shows. */
  it("marks the address disabled in Incognito", () => {
    mockScAddress = SC_ADDRESS
    mockIsAnonMode = true
    mockIsLightningAddressGated = true

    render(<AccountLNAddress />)

    expect(lastRowProps().title).toBe(`${SC_ADDRESS} (disabled)`)
  })

  /** The suffix is a label, not part of the address: copying it would hand the user a
   *  string no wallet can pay, so the disabled row offers no copy at all. */
  it("never copies the disabled label in Incognito", () => {
    mockScAddress = SC_ADDRESS
    mockIsAnonMode = true
    mockIsLightningAddressGated = true

    render(<AccountLNAddress />)

    expect(lastRowProps().rightIcon).toBeUndefined()

    act(() => (lastRowProps().action as () => void)())

    expect(mockCopyToClipboard).not.toHaveBeenCalled()
  })

  /** Nothing to disable, so the suffix must not turn the create prompt into a lie. */
  it("leaves the create prompt untouched in Incognito when no address exists", () => {
    mockScAddress = null
    mockIsAnonMode = true

    render(<AccountLNAddress />)

    expect(lastRowProps().title).toBe("Create address")
  })

  /** Incognito registration is allowed now — the anon-friendly twentyone.ist server
   *  accepts it (fork `--allow-anon-addresses`) — so the row navigates into the
   *  domain-choice flow, where blink.sv is greyed out. */
  it("navigates to the domain choice in Incognito when no address exists", () => {
    mockScAddress = null
    mockIsAnonMode = true

    render(<AccountLNAddress />)

    act(() => (lastRowProps().action as () => void)())

    expect(mockNavigate).toHaveBeenCalledWith("selfCustodialChooseLnurlDomain")
  })

  it("shows the registered address and copies it on press", () => {
    mockScAddress = SC_ADDRESS

    render(<AccountLNAddress />)

    expect(lastRowProps().title).toBe(SC_ADDRESS)
    expect(lastRowProps().rightIcon).toBeTruthy()

    act(() => (lastRowProps().action as () => void)())

    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({ content: SC_ADDRESS }),
    )
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("opens the backup-required modal instead of navigating when backup is not completed", () => {
    mockBackupStatus = "none"
    mockScAddress = null

    render(<AccountLNAddress />)

    expect(lastRowProps().title).toBe("Create address")
    expect(mockBackupRequiredModal.mock.calls.at(-1)?.[0]?.isVisible).toBe(false)

    act(() => (lastRowProps().action as () => void)())

    expect(mockBackupRequiredModal.mock.calls.at(-1)?.[0]?.isVisible).toBe(true)
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockCopyToClipboard).not.toHaveBeenCalled()
  })

  it("also gates address creation while the backup is still pending", () => {
    mockBackupStatus = "pending"
    mockScAddress = null

    render(<AccountLNAddress />)

    act(() => (lastRowProps().action as () => void)())

    expect(mockBackupRequiredModal.mock.calls.at(-1)?.[0]?.isVisible).toBe(true)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it("closes the backup-required modal through its onClose prop", () => {
    mockBackupStatus = "none"
    mockScAddress = null

    render(<AccountLNAddress />)

    act(() => (lastRowProps().action as () => void)())
    expect(mockBackupRequiredModal.mock.calls.at(-1)?.[0]?.isVisible).toBe(true)

    act(() => (mockBackupRequiredModal.mock.calls.at(-1)?.[0]?.onClose as () => void)())

    expect(mockBackupRequiredModal.mock.calls.at(-1)?.[0]?.isVisible).toBe(false)
  })

  it("still copies an existing address on press when backup is not completed", () => {
    mockBackupStatus = "none"
    mockScAddress = SC_ADDRESS

    render(<AccountLNAddress />)

    act(() => (lastRowProps().action as () => void)())

    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({ content: SC_ADDRESS }),
    )
    expect(mockBackupRequiredModal.mock.calls.at(-1)?.[0]?.isVisible).toBe(false)
  })

  it("shows the persisted address (not the set prompt) while the live address is still resolving", () => {
    mockScAddress = SC_ADDRESS

    render(<AccountLNAddress />)

    expect(lastRowProps().title).toBe(SC_ADDRESS)
    expect(lastRowProps().rightIcon).toBeTruthy()
  })
})

describe("AccountLNAddress (custodial)", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // an incomplete backup must never gate the custodial flow
    mockBackupStatus = "none"
    mockScAddress = null
    mockUseSelfCustodialWallet.mockReturnValue({ lightningAddress: null })
    mockUseAccountRegistry.mockReturnValue({
      activeAccount: { id: "cust-1", type: AccountType.Custodial },
    })
  })

  it("prompts to create an address and opens the custodial modal when there is no username", () => {
    mockSettingsScreenQuery.mockReturnValue({
      data: { me: { username: null } },
      loading: false,
    })

    render(<AccountLNAddress />)

    expect(lastRowProps().title).toBe("Create address")
    expect(lastRowProps().rightIcon).toBeUndefined()
    expect(mockCustodialModal.mock.calls.at(-1)?.[0]?.isVisible).toBe(false)

    act(() => (lastRowProps().action as () => void)())

    expect(mockCustodialModal.mock.calls.at(-1)?.[0]?.isVisible).toBe(true)
    expect(mockBackupRequiredModal).not.toHaveBeenCalled()
    expect(mockCopyToClipboard).not.toHaveBeenCalled()
  })

  it("shows the username@host address and copies it on press", () => {
    mockSettingsScreenQuery.mockReturnValue({
      data: { me: { username: "bob" } },
      loading: false,
    })

    render(<AccountLNAddress />)

    expect(lastRowProps().title).toBe("bob@blink.sv")
    expect(lastRowProps().rightIcon).toBeTruthy()

    act(() => (lastRowProps().action as () => void)())

    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({ content: "bob@blink.sv" }),
    )
  })
})
