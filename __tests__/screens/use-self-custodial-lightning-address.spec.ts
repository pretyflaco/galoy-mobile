/**
 * Stale-domain handling for the persisted lightning-address fallback: an address
 * registered under a different lnurl domain than the account's chosen one must not
 * resurrect as a dead, unchangeable value — the account reads as "no address set"
 * until re-registration. The comparison is against the account's OWN stored domain
 * (blink.sv default, or twentyone.ist when chosen), not a build-wide constant.
 */
import { renderHook } from "@testing-library/react-native"

jest.mock("@app/hooks/use-account-registry", () => ({
  useAccountRegistry: jest.fn(),
}))
jest.mock("@app/self-custodial/providers/wallet", () => ({
  useSelfCustodialWallet: jest.fn(),
}))
jest.mock("@app/self-custodial/hooks/use-spark-network", () => ({
  useSparkNetwork: jest.fn(),
}))

import { Network } from "@breeztech/breez-sdk-spark-react-native"

import { useAccountRegistry } from "@app/hooks/use-account-registry"
import { useSelfCustodialWallet } from "@app/self-custodial/providers/wallet"
import { useSparkNetwork } from "@app/self-custodial/hooks/use-spark-network"
import { useSelfCustodialLightningAddress } from "@app/screens/settings-screen/settings/use-self-custodial-lightning-address"

const registry = useAccountRegistry as jest.Mock
const wallet = useSelfCustodialWallet as jest.Mock
const network = useSparkNetwork as jest.Mock

const entry = (
  lightningAddress: string | null,
  lnurlDomain: "blink.sv" | "twentyone.ist" | null = null,
) => ({ id: "acct-1", lightningAddress, lnurlDomain })

beforeEach(() => {
  registry.mockReturnValue({
    activeAccount: { id: "acct-1", type: "self-custodial" },
    selfCustodialEntries: [entry("bulus@blink.sv", "blink.sv")],
  })
  wallet.mockReturnValue({ lightningAddress: null })
  network.mockReturnValue(Network.Mainnet)
})

describe("useSelfCustodialLightningAddress", () => {
  it("falls back to the persisted address when it matches the account's chosen domain", () => {
    const { result } = renderHook(() => useSelfCustodialLightningAddress())
    expect(result.current).toBe("bulus@blink.sv")
  })

  it("treats a persisted address on a different domain than chosen as unset", () => {
    // Account chose twentyone.ist but holds a stale blink.sv address.
    registry.mockReturnValue({
      activeAccount: { id: "acct-1", type: "self-custodial" },
      selfCustodialEntries: [entry("bulus@blink.sv", "twentyone.ist")],
    })
    const { result } = renderHook(() => useSelfCustodialLightningAddress())
    expect(result.current).toBeNull()
  })

  it("reads an account with no stored choice as the blink.sv default", () => {
    // lnurlDomain null (predates selection) → defaults to blink.sv, matching a blink.sv address.
    registry.mockReturnValue({
      activeAccount: { id: "acct-1", type: "self-custodial" },
      selfCustodialEntries: [entry("bulus@blink.sv", null)],
    })
    const { result } = renderHook(() => useSelfCustodialLightningAddress())
    expect(result.current).toBe("bulus@blink.sv")
  })

  it("prefers the live SDK value over any persisted one", () => {
    wallet.mockReturnValue({ lightningAddress: "live@twentyone.ist" })
    const { result } = renderHook(() => useSelfCustodialLightningAddress())
    expect(result.current).toBe("live@twentyone.ist")
  })
})
