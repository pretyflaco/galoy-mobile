/**
 * Creation flow navigator (redesign r3, spec §6.1–6.4). Asserts behavior via testIDs
 * (the test harness loads i18n locale async, so text assertions are unreliable):
 *   - eligible accounts (self-custodial + backed-up seed) get the key-source choice and
 *     NO key is generated until a choice is made;
 *   - ineligible accounts (custodial / seed not backed up) SKIP the choice and generate
 *     a fresh random key immediately;
 *   - there is NO confirm step and NO result screen — success exits straight to the Hub;
 *   - a seed-derived creation writes the "wallet-seed" backup marker (auto backed up);
 *   - a fail-closed keygen error offers Try Again / Cancel; the nsec is never rendered.
 */
import React from "react"
import { render, fireEvent, waitFor } from "@testing-library/react-native"

import { CreateIdentityNavigator } from "@app/screens/nostr/create-identity"
import KeyStoreWrapper from "@app/utils/storage/secureStorage"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const generateNostrKey = jest.fn(() => ({
  privKeyHex: "1".repeat(64),
  pubKeyHex: "a".repeat(64),
}))
jest.mock("@app/nostr/core/keygen", () => ({
  generateNostrKey: () => generateNostrKey(),
  secureRandomBytes: (n: number) => new Uint8Array(n),
}))
jest.mock("@app/nostr/core/keystore", () => ({
  NOSTR_NSEC_SERVICE: "nostr.nsec",
  writeSecret: jest.fn().mockResolvedValue(undefined),
}))
jest.mock("@app/nostr/analytics", () => ({
  logNostrIdentityCeremonyStarted: jest.fn(),
  logNostrIdentityCeremonyCompleted: jest.fn(),
}))

const saveString = jest.fn().mockResolvedValue(undefined)
jest.mock("@app/utils/storage/storage", () => ({
  saveString: (...args: unknown[]) => saveString(...args),
  loadString: jest.fn().mockResolvedValue(null),
}))

// Seed-path derivation is mocked at the module edge (no real mnemonic in tests).
const deriveNsecFromMnemonic = jest.fn(() => ({
  privKeyHex: "2".repeat(64),
  pubKeyHex: "b".repeat(64),
}))
jest.mock("@app/self-custodial/derive-nostr-key", () => ({
  deriveNsecFromMnemonic: () => deriveNsecFromMnemonic(),
}))

// Account mode + wallet backup state drive the key-source eligibility gate (spec §7.3).
const mockAccountMode = jest.fn(() => ({
  isSelfCustodial: false,
  accountKey: null as string | null,
}))
jest.mock("@app/nostr/use-nostr-account-key", () => ({
  useNostrAccountMode: () => mockAccountMode(),
}))

const mockBackupStatus = jest.fn(() => "none")
jest.mock("@app/self-custodial/providers/backup-state", () => ({
  ...jest.requireActual("@app/self-custodial/providers/backup-state"),
  useBackupState: () => ({ backupState: { status: mockBackupStatus() } }),
}))

// Account-scoped persistence (2026-08-20): the ceremony reads the account scope from the
// runtime provider context; fix it to a test account. The runtime stub carries the H3
// voidAllConnections hook the ceremony calls after a successful commit.
jest.mock("@app/nostr/nostr-runtime-provider", () => ({
  useNostrRuntime: () => ({
    accountKey: "test-account",
    runtime: { voidAllConnections: jest.fn().mockResolvedValue(undefined) },
  }),
}))

const renderNav = (onExit = jest.fn()) => {
  const utils = render(
    <ContextForScreen>
      <CreateIdentityNavigator onExit={onExit} />
    </ContextForScreen>,
  )
  return { ...utils, onExit }
}

// The Generating step has a deliberate minimum on-screen time (GENERATING_MIN_MS).
const waitForExit = (onExit: jest.Mock) =>
  waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 4000 })

describe("creation flow navigator (redesign r3)", () => {
  beforeEach(() => {
    jest
      .spyOn(KeyStoreWrapper, "getMnemonicForAccount")
      .mockResolvedValue("test mnemonic words")
  })

  afterEach(() => {
    generateNostrKey.mockClear()
    deriveNsecFromMnemonic.mockClear()
    saveString.mockClear()
  })

  describe("ineligible accounts (custodial / seed not backed up)", () => {
    beforeEach(() => {
      mockAccountMode.mockReturnValue({ isSelfCustodial: false, accountKey: null })
      mockBackupStatus.mockReturnValue("none")
    })

    it("SKIPS the key-source choice and generates a random key immediately", async () => {
      const { queryByTestId, onExit } = renderNav()
      // The choice screen is never shown; generation starts on mount (spec §7.3).
      expect(queryByTestId("nostr-create-choose-source")).toBeNull()
      await waitFor(() => expect(generateNostrKey).toHaveBeenCalledTimes(1))
      await waitForExit(onExit) // straight to the Hub — no confirm/result screen
      // A random key is NOT covered by the wallet backup → no marker written.
      expect(saveString).not.toHaveBeenCalled()
    })
  })

  describe("eligible accounts (self-custodial + backed-up seed)", () => {
    beforeEach(() => {
      mockAccountMode.mockReturnValue({
        isSelfCustodial: true,
        accountKey: "self-custodial-0",
      })
      mockBackupStatus.mockReturnValue("completed")
    })

    it("shows the choice and generates NO key until a source is chosen", async () => {
      const { getByTestId } = renderNav()
      await flushEffects()
      expect(getByTestId("nostr-create-choose-source")).toBeTruthy()
      expect(getByTestId("nostr-create-from-wallet")).toBeTruthy()
      expect(getByTestId("nostr-create-new-random")).toBeTruthy()
      expect(generateNostrKey).not.toHaveBeenCalled()
      expect(deriveNsecFromMnemonic).not.toHaveBeenCalled()
    })

    it("Generate from wallet derives deterministically and marks the identity backed up", async () => {
      const { getByTestId, onExit } = renderNav()
      await flushEffects()
      fireEvent.press(getByTestId("nostr-create-from-wallet"))
      await waitFor(() => expect(deriveNsecFromMnemonic).toHaveBeenCalledTimes(1))
      expect(generateNostrKey).not.toHaveBeenCalled()
      await waitForExit(onExit)
      // Wallet-derived keys are auto backed up (spec §8): the wallet-seed marker is written.
      await waitFor(() =>
        expect(saveString).toHaveBeenCalledWith(
          "nostr.backupDone.test-account",
          "wallet-seed",
        ),
      )
    })

    it("Generate new creates a fresh random key with NO backup marker", async () => {
      const { getByTestId, onExit } = renderNav()
      await flushEffects()
      fireEvent.press(getByTestId("nostr-create-new-random"))
      await waitFor(() => expect(generateNostrKey).toHaveBeenCalledTimes(1))
      expect(deriveNsecFromMnemonic).not.toHaveBeenCalled()
      await waitForExit(onExit)
      expect(saveString).not.toHaveBeenCalled()
    })
  })

  describe("fail-closed error", () => {
    it("offers Try Again + Cancel; no partial identity, nsec never rendered", async () => {
      mockAccountMode.mockReturnValue({ isSelfCustodial: false, accountKey: null })
      mockBackupStatus.mockReturnValue("none")
      generateNostrKey.mockImplementationOnce(() => {
        throw new Error("CSPRNG unavailable")
      })
      const { getByTestId, queryByText, onExit } = renderNav()
      await waitFor(() => expect(getByTestId("nostr-generating-error")).toBeTruthy(), {
        timeout: 4000,
      })
      expect(onExit).not.toHaveBeenCalled()
      expect(queryByText("1".repeat(64))).toBeNull()
      // Try Again regenerates successfully and exits to the Hub
      fireEvent.press(getByTestId("nostr-generating-retry"))
      await waitForExit(onExit)
    })
  })
})
