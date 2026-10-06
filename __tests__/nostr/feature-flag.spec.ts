/**
 * Story 1.4 / AC-1,2 (Task 1) — the signer flag is owned by app/nostr/config.ts and
 * wired into the EXISTING remote-flag substrate, defaulting OFF.
 */
import { SignerEnabledKey } from "../../app/nostr/config"

jest.mock("@react-native-firebase/remote-config", () => ({
  __esModule: true,
  default: () => ({
    setDefaults: jest.fn(),
    setConfigSettings: jest.fn(),
    getValue: jest.fn(() => ({
      asString: () => "",
      asBoolean: () => false,
      asNumber: () => 0,
    })),
    fetchAndActivate: jest.fn().mockResolvedValue(true),
  }),
}))

describe("signer feature flag (Task 1)", () => {
  it("config.ts owns the flag key constant", () => {
    expect(SignerEnabledKey).toBe("nostrSignerEnabled")
  })

  it("defaultRemoteConfig defaults the signer flag OFF", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { defaultRemoteConfig } = require("@app/config/feature-flags-context")
    expect(defaultRemoteConfig[SignerEnabledKey]).toBe(false)
  })
})
