/**
 * AC-7 prerequisite — self-custodial account detection for the nostr module scope.
 *
 * The delegated-grants feature (and any other wallet-facing nostr feature) must know whether
 * the ACTIVE account is a self-custodial (Spark) account, using the same custody split as
 * useNostrAccountKey (persistentState.activeAccountId), NOT use-active-wallet's
 * SDK-availability-conflated isSelfCustodial.
 */
import { renderHook } from "@testing-library/react-native"

const persistentState = { activeAccountId: undefined as string | undefined }
jest.mock("@app/store/persistent-state", () => ({
  usePersistentStateContext: () => ({ persistentState }),
}))

import { useNostrAccountMode } from "@app/nostr/use-nostr-account-key"
import { DefaultAccountId } from "@app/types/wallet"

describe("useNostrAccountMode", () => {
  it("reports self-custodial when activeAccountId is a device account id", () => {
    persistentState.activeAccountId = "device-account-1"
    const { result } = renderHook(() => useNostrAccountMode())
    expect(result.current.isSelfCustodial).toBe(true)
    expect(result.current.accountKey).toBe("device-account-1")
  })

  it("reports custodial for the default custodial account id", () => {
    persistentState.activeAccountId = DefaultAccountId.Custodial
    const { result } = renderHook(() => useNostrAccountMode())
    expect(result.current.isSelfCustodial).toBe(false)
    expect(result.current.accountKey).toBeNull()
  })

  it("reports custodial when no account is set", () => {
    persistentState.activeAccountId = undefined
    const { result } = renderHook(() => useNostrAccountMode())
    expect(result.current.isSelfCustodial).toBe(false)
    expect(result.current.accountKey).toBeNull()
  })
})
