import { renderHook } from "@testing-library/react-native"
import { Network } from "@breeztech/breez-sdk-spark-react-native"

import { useAccountLightningAddresses } from "@app/self-custodial/hooks/use-account-lightning-addresses"
import {
  defaultPersistentState,
  PersistentState,
} from "@app/store/persistent-state/state-migrations"
import { AccountMode } from "@app/types/account"

/**
 * Pins the two-address rules end to end through the real composition (mode from stored
 * state, primary from the wallet/registry, alt from the account entry): which address is
 * usable in which mode, and which domain each slot reports.
 */

let mockPersistentState: PersistentState

jest.mock("@app/store/persistent-state", () => ({
  usePersistentStateContext: () => ({
    persistentState: mockPersistentState,
    updateState: jest.fn(),
  }),
}))

jest.mock("@app/self-custodial/hooks/use-spark-network", () => ({
  useSparkNetwork: () => Network.Mainnet,
}))

const mockRegistry = jest.fn()
jest.mock("@app/hooks/use-account-registry", () => ({
  useAccountRegistry: () => mockRegistry(),
}))

jest.mock("@app/self-custodial/providers/wallet", () => ({
  useSelfCustodialWallet: () => ({ lightningAddress: null }),
}))

const baseState: PersistentState = defaultPersistentState

const stateWithMode = (mode: AccountMode): PersistentState => ({
  ...baseState,
  activeAccountId: "self-custodial-1",
  selfCustodialAccountModeByAccountId: { "self-custodial-1": mode },
})

const registryWith = (
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
  mockPersistentState = stateWithMode(AccountMode.Enhanced)
})

describe("useAccountLightningAddresses", () => {
  it("reports each domain from whichever slot holds it", () => {
    mockRegistry.mockReturnValue(
      registryWith("satoshi@twentyone.ist", "twentyone.ist", "satoshi@blink.sv"),
    )

    const { result } = renderHook(() => useAccountLightningAddresses())

    expect(result.current.primary).toBe("satoshi@twentyone.ist")
    expect(result.current.alt).toBe("satoshi@blink.sv")
    expect(result.current.blinkSvAddress).toBe("satoshi@blink.sv")
    expect(result.current.twentyoneIstAddress).toBe("satoshi@twentyone.ist")
  })

  it("Enhanced prefers the blink.sv address regardless of which slot holds it", () => {
    mockRegistry.mockReturnValue(
      registryWith("satoshi@twentyone.ist", "twentyone.ist", "satoshi@blink.sv"),
    )

    const { result } = renderHook(() => useAccountLightningAddresses())

    expect(result.current.effective).toBe("satoshi@blink.sv")
  })

  it("Enhanced falls back to the twentyone.ist address when no blink.sv one exists", () => {
    mockRegistry.mockReturnValue(
      registryWith("satoshi@twentyone.ist", "twentyone.ist"),
    )

    const { result } = renderHook(() => useAccountLightningAddresses())

    expect(result.current.effective).toBe("satoshi@twentyone.ist")
  })

  it("Incognito answers only on the twentyone.ist address, never the dormant blink.sv one", () => {
    mockPersistentState = stateWithMode(AccountMode.Anon)
    mockRegistry.mockReturnValue(
      registryWith("satoshi@blink.sv", "blink.sv", "satoshi@twentyone.ist"),
    )

    const { result } = renderHook(() => useAccountLightningAddresses())

    expect(result.current.effective).toBe("satoshi@twentyone.ist")
  })

  it("Incognito with only a blink.sv address has no usable address", () => {
    mockPersistentState = stateWithMode(AccountMode.Anon)
    mockRegistry.mockReturnValue(registryWith("satoshi@blink.sv", "blink.sv"))

    const { result } = renderHook(() => useAccountLightningAddresses())

    expect(result.current.effective).toBeNull()
  })

  it("reads a null-alt account as single-domain", () => {
    mockRegistry.mockReturnValue(registryWith("satoshi@blink.sv", "blink.sv"))

    const { result } = renderHook(() => useAccountLightningAddresses())

    expect(result.current.alt).toBeNull()
    expect(result.current.blinkSvAddress).toBe("satoshi@blink.sv")
    expect(result.current.twentyoneIstAddress).toBeNull()
  })
})
