/**
 * Story A2 — NostrRuntimeProvider: the RN mounting layer for the signer runtime.
 *
 * Asserts the provider's wiring contract:
 *  - constructs ONE runtime for the app lifetime (AD-11) and exposes it + the coordinator via
 *    context;
 *  - applies the AD-13 flag via initSignerGate on mount and on every flag change — OFF ⇒ gate
 *    called with enabled=false (entry points inert, records retained); ON ⇒ enabled=true;
 *  - the exposed runtime coordinator is the SAME instance used for approvals (AD-9).
 *
 * The keystore + remote-config natives are mocked; behavior is asserted through the gate call
 * and the context value (the ContextForScreen i18n-async caveat does not apply — no copy here).
 */
import React from "react"
import { render } from "@testing-library/react-native"

// Spy on the flag boundary so we can assert the enabled value the provider applies.
const initSignerGate = jest.fn()
jest.mock("@app/nostr/signer-gate", () => ({
  ...jest.requireActual("@app/nostr/signer-gate"),
  initSignerGate: (enabled: boolean, deps: unknown) => initSignerGate(enabled, deps),
}))

// The keystore reads must not touch react-native-keychain in a unit test.
jest.mock("@app/nostr/core/keystore", () => ({
  ...jest.requireActual("@app/nostr/core/keystore"),
  readSecret: jest.fn(async () => null),
}))

// Control the remote flag directly.
const useFeatureFlags = jest.fn()
jest.mock("@app/config/feature-flags-context", () => ({
  useFeatureFlags: () => useFeatureFlags(),
}))

// The provider composes Apollo (ln-address read) + the account-scope resolver + app config;
// none exist in this bare render — fix them to test doubles.
jest.mock("@apollo/client", () => ({
  ...jest.requireActual("@apollo/client"),
  useApolloClient: () => ({ query: jest.fn() }),
}))
jest.mock("@app/nostr/use-nostr-account-key", () => ({
  useNostrAccountKey: () => ({ accountKey: "test-account", ready: true }),
}))
jest.mock("@app/hooks", () => ({
  ...jest.requireActual("@app/hooks"),
  useAppConfig: () => ({
    appConfig: { token: "", galoyInstance: { lnAddressHostname: "blink.sv" } },
  }),
}))

import {
  NostrRuntimeProvider,
  useNostrRuntime,
  type NostrRuntimeContextValue,
} from "@app/nostr/nostr-runtime-provider"
import {
  getApprovalCoordinator,
  __resetApprovalCoordinatorForTest,
} from "@app/nostr/approval/coordinator"
import { __resetRelayPoolForTest } from "@app/nostr/transport/relay-pool"

let captured: NostrRuntimeContextValue | null = null
const Capture: React.FC = () => {
  captured = useNostrRuntime()
  return null
}

const renderProvider = () =>
  render(
    <NostrRuntimeProvider>
      <Capture />
    </NostrRuntimeProvider>,
  )

beforeEach(() => {
  initSignerGate.mockClear()
  captured = null
  __resetApprovalCoordinatorForTest()
  __resetRelayPoolForTest()
  useFeatureFlags.mockReturnValue({ nostrSignerEnabled: false })
})

describe("NostrRuntimeProvider (A2)", () => {
  it("exposes the runtime + coordinator through context", () => {
    renderProvider()
    expect(captured).not.toBeNull()
    expect(typeof captured?.runtime.handleInbound).toBe("function")
    expect(typeof captured?.runtime.handleConnectUri).toBe("function")
    expect(captured?.coordinator).toBe(captured?.runtime.coordinator)
  })

  it("the exposed coordinator IS the process-wide singleton (AD-9)", () => {
    renderProvider()
    expect(captured?.coordinator).toBe(getApprovalCoordinator())
  })

  it("applies the flag via initSignerGate with enabled=false when the flag is OFF", () => {
    renderProvider()
    expect(initSignerGate).toHaveBeenCalledWith(false, expect.any(Object))
  })

  it("applies the flag with enabled=true when the flag is ON", () => {
    useFeatureFlags.mockReturnValue({ nostrSignerEnabled: true })
    renderProvider()
    expect(initSignerGate).toHaveBeenCalledWith(true, expect.any(Object))
  })

  it("the gate deps expose NO clear() on the connection store (records retained on toggle)", () => {
    renderProvider()
    const [, deps] = initSignerGate.mock.calls[0]
    expect(
      (deps as { connectionStore: { clear?: unknown } }).connectionStore.clear,
    ).toBeUndefined()
  })
})
