/**
 * Story 1.5 — ceremony navigator (Tasks 1,2,4,5 UI). Asserts behavior via testIDs
 * (the test harness loads i18n locale async, so text assertions are unreliable — the
 * i18n *sourcing* is verified separately by the hardcoded-string lint in Task 9):
 *   - intro generates NO key on mount and NO key on intro→confirm;
 *   - confirm generates exactly once and reaches the result screen;
 *   - the result shows the labeled npub + backup offer, and never renders the nsec.
 */
import React from "react"
import { render, fireEvent, waitFor } from "@testing-library/react-native"

import { CreateIdentityNavigator } from "@app/screens/nostr/create-identity"

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

// Account-scoped persistence (2026-08-20): the ceremony reads the account scope from the
// runtime provider context; fix it to a test account. The runtime stub carries the H3
// voidAllConnections hook the ceremony calls after a successful commit.
jest.mock("@app/nostr/nostr-runtime-provider", () => ({
  useNostrRuntime: () => ({
    accountKey: "test-account",
    runtime: { voidAllConnections: jest.fn().mockResolvedValue(undefined) },
  }),
}))

// npub for pubkey "a".repeat(64) is deterministic via nip19; assert it is shown truncated.

const renderNav = () =>
  render(
    <ContextForScreen>
      <CreateIdentityNavigator
        onImport={jest.fn()}
        onBackup={jest.fn()}
        onExit={jest.fn()}
      />
    </ContextForScreen>,
  )

describe("ceremony navigator (AC-1)", () => {
  afterEach(() => generateNostrKey.mockClear())

  it("generates NO key on mount", async () => {
    const { getByTestId } = renderNav()
    await flushEffects()
    expect(getByTestId("nostr-create-identity")).toBeTruthy()
    expect(getByTestId("nostr-import-identity")).toBeTruthy()
    expect(generateNostrKey).not.toHaveBeenCalled()
  })

  it("intro→confirm does not generate; confirm generates once and reaches result", async () => {
    const { getByTestId, queryByTestId, queryByText } = renderNav()
    await flushEffects()

    fireEvent.press(getByTestId("nostr-create-identity"))
    await flushEffects()
    expect(generateNostrKey).not.toHaveBeenCalled()
    expect(getByTestId("nostr-ceremony-confirm")).toBeTruthy()

    fireEvent.press(getByTestId("nostr-ceremony-confirm"))
    await waitFor(() => expect(queryByTestId("nostr-npub")).toBeTruthy())
    expect(generateNostrKey).toHaveBeenCalledTimes(1)

    // backup offer present; the nsec (private key hex) is NEVER rendered
    expect(getByTestId("nostr-backup-key")).toBeTruthy()
    expect(getByTestId("nostr-backup-not-now")).toBeTruthy()
    expect(queryByText("1".repeat(64))).toBeNull()
    // npub is shown truncated (not the full 63-char bech32) by default
    expect(getByTestId("nostr-npub").props.children).toContain("…")
  })
})
