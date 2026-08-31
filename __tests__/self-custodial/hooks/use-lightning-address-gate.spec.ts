import { renderHook } from "@testing-library/react-native"
import { Network } from "@breeztech/breez-sdk-spark-react-native"

import { useLightningAddressGated } from "@app/self-custodial/hooks/use-lightning-address-gate"
import {
  defaultPersistentState,
  PersistentState,
} from "@app/store/persistent-state/state-migrations"
import { AccountMode } from "@app/types/account"

/**
 * Drives the real account-mode hook off a stubbed persistent state rather than mocking
 * the mode away, so this pins the rule end to end: what is stored for the active account
 * decides whether the address is offered as a way to get paid. The gate is domain-aware:
 * in Incognito only a twentyone.ist address (the anon-friendly fork server) stays
 * available — a blink.sv address is dormant upstream and is withheld.
 */

let mockPersistentState: PersistentState

jest.mock("@app/store/persistent-state", () => ({
  usePersistentStateContext: () => ({
    persistentState: mockPersistentState,
    updateState: jest.fn(),
  }),
}))

const mockUseSparkNetwork = jest.fn()
jest.mock("@app/self-custodial/hooks/use-spark-network", () => ({
  useSparkNetwork: () => mockUseSparkNetwork(),
}))

const mockRegistry = jest.fn()
jest.mock("@app/hooks/use-account-registry", () => ({
  useAccountRegistry: () => mockRegistry(),
}))

const mockWallet = jest.fn()
jest.mock("@app/self-custodial/providers/wallet", () => ({
  useSelfCustodialWallet: () => mockWallet(),
}))

/** Taken from the real default rather than a literal: the mode is what this spec is
 *  about, and a pinned schema version would only break on the next migration. */
const baseState: PersistentState = defaultPersistentState

const stateWithMode = (mode: AccountMode): PersistentState => ({
  ...baseState,
  activeAccountId: "self-custodial-1",
  selfCustodialAccountModeByAccountId: { "self-custodial-1": mode },
})

const registryWithAddress = (
  lightningAddress: string | null,
  lnurlDomain: "blink.sv" | "twentyone.ist" | null = null,
  altLightningAddress: string | null = null,
) => ({
  activeAccount: { id: "self-custodial-1", type: "self-custodial" },
  selfCustodialEntries: [
    { id: "self-custodial-1", lightningAddress, lnurlDomain, altLightningAddress },
  ],
})

beforeEach(() => {
  mockPersistentState = { ...baseState }
  mockUseSparkNetwork.mockReturnValue(Network.Mainnet)
  mockWallet.mockReturnValue({ lightningAddress: null })
  mockRegistry.mockReturnValue(registryWithAddress(null))
})

describe("useLightningAddressGated", () => {
  it("withholds a blink.sv address in Incognito (dormant upstream)", () => {
    mockPersistentState = stateWithMode(AccountMode.Anon)
    mockRegistry.mockReturnValue(
      registryWithAddress("satoshi@blink.sv", "blink.sv"),
    )

    const { result } = renderHook(() => useLightningAddressGated())

    expect(result.current).toBe(true)
  })

  it("keeps a twentyone.ist address available in Incognito (anon-friendly fork server)", () => {
    mockPersistentState = stateWithMode(AccountMode.Anon)
    mockRegistry.mockReturnValue(
      registryWithAddress("satoshi@twentyone.ist", "twentyone.ist"),
    )

    const { result } = renderHook(() => useLightningAddressGated())

    expect(result.current).toBe(false)
  })

  it("withholds a legacy-domain address in Incognito even without a stored choice", () => {
    mockPersistentState = stateWithMode(AccountMode.Anon)
    // No stored lnurlDomain (predates the choice feature) and the address is not on
    // the anon-friendly domain → dormant upstream → withheld.
    mockRegistry.mockReturnValue(registryWithAddress("satoshi@blink.sv", null))

    const { result } = renderHook(() => useLightningAddressGated())

    expect(result.current).toBe(true)
  })

  it("offers creation (not gated) in Incognito when no address exists", () => {
    mockPersistentState = stateWithMode(AccountMode.Anon)

    const { result } = renderHook(() => useLightningAddressGated())

    expect(result.current).toBe(false)
  })

  /** The alt slot holds an address the SDK never learned of (REST-registered on the
   *  other domain): a twentyone.ist alt lifts the gate even when the primary sits on
   *  blink.sv. */
  it("keeps the account payable in Incognito via a twentyone.ist ALT address", () => {
    mockPersistentState = stateWithMode(AccountMode.Anon)
    mockRegistry.mockReturnValue(
      registryWithAddress("satoshi@blink.sv", "blink.sv", "satoshi@twentyone.ist"),
    )

    const { result } = renderHook(() => useLightningAddressGated())

    expect(result.current).toBe(false)
  })

  it("keeps the account payable in Incognito when the ALT slot is the only address", () => {
    mockPersistentState = stateWithMode(AccountMode.Anon)
    mockRegistry.mockReturnValue(
      registryWithAddress(null, null, "satoshi@twentyone.ist"),
    )

    const { result } = renderHook(() => useLightningAddressGated())

    expect(result.current).toBe(false)
  })

  it("leaves the address available in Enhanced", () => {
    mockPersistentState = stateWithMode(AccountMode.Enhanced)
    mockRegistry.mockReturnValue(registryWithAddress("satoshi@blink.sv", "blink.sv"))

    const { result } = renderHook(() => useLightningAddressGated())

    expect(result.current).toBe(false)
  })

  /** An account that has not chosen a mode is not Incognito, so nothing is withheld:
   *  only the stored Incognito choice withdraws the address. */
  it("leaves the address available before a mode has been chosen", () => {
    mockPersistentState = { ...baseState, activeAccountId: "self-custodial-1" }
    mockRegistry.mockReturnValue(registryWithAddress("satoshi@blink.sv", "blink.sv"))

    const { result } = renderHook(() => useLightningAddressGated())

    expect(result.current).toBe(false)
  })

  /** A custodial session has no self-custodial mode to read, and its address is the
   *  server's username, which this gate has no business withdrawing. */
  it("leaves the address available when no self-custodial account is active", () => {
    const { result } = renderHook(() => useLightningAddressGated())

    expect(result.current).toBe(false)
  })
})
