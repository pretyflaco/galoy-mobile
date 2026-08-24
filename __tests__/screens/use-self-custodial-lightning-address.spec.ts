/**
 * Stale-domain handling for the persisted lightning-address fallback: an address
 * registered under a different lnurl domain than the SDK's configured one must not
 * resurrect as a dead, unchangeable value — the account reads as "no address set"
 * until re-registration.
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

// Mainnet in this test file → lnurlDomainFor returns the fork POC domain.
const FORK_DOMAIN = "lnurl.twentyone.ist"

beforeEach(() => {
  registry.mockReturnValue({
    activeAccount: { id: "acct-1", type: "self-custodial" },
    selfCustodialEntries: [{ id: "acct-1", lightningAddress: `bulus@${FORK_DOMAIN}` }],
  })
  wallet.mockReturnValue({ lightningAddress: null })
  network.mockReturnValue(Network.Mainnet)
})

describe("useSelfCustodialLightningAddress", () => {
  it("falls back to the persisted address when its domain matches the SDK's domain", () => {
    const { result } = renderHook(() => useSelfCustodialLightningAddress())
    expect(result.current).toBe(`bulus@${FORK_DOMAIN}`)
  })

  it("treats a persisted address on a stale domain as unset", () => {
    registry.mockReturnValue({
      activeAccount: { id: "acct-1", type: "self-custodial" },
      selfCustodialEntries: [{ id: "acct-1", lightningAddress: "bulus@blink.sv" }],
    })
    const { result } = renderHook(() => useSelfCustodialLightningAddress())
    expect(result.current).toBeNull()
  })

  it("prefers the live SDK value over any persisted one", () => {
    wallet.mockReturnValue({ lightningAddress: `live@${FORK_DOMAIN}` })
    const { result } = renderHook(() => useSelfCustodialLightningAddress())
    expect(result.current).toBe(`live@${FORK_DOMAIN}`)
  })
})
