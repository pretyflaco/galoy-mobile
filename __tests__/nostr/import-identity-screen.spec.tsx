/**
 * Import screen UI (Story 1.6 + redesign r3, spec §7.11). Validation runs LIVE: the CTA
 * stays disabled ("Paste your key") until a valid nsec makes it "Continue"; a malformed
 * or non-secret value shows the inline error and changes NO state. An existing identity
 * surfaces the consent-danger replace confirm; a first import commits directly. The nsec
 * is never rendered as visible text.
 */
import React from "react"
import { render, fireEvent, waitFor } from "@testing-library/react-native"

import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

import { NostrImportIdentityScreen } from "@app/screens/nostr/import-identity"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

// An identity EXISTS on this account (readSecret resolves an nsec), so a valid import
// takes the replace-consent path; flip to null in the first-import test.
const readSecret = jest.fn().mockResolvedValue("f".repeat(64))
jest.mock("@app/nostr/core/keystore", () => ({
  NOSTR_NSEC_SERVICE: "nostr.nsec",
  writeSecret: jest.fn().mockResolvedValue(undefined),
  readSecret: (...args: unknown[]) => readSecret(...args),
}))

jest.mock("@app/nostr/nostr-runtime-provider", () => ({
  useNostrRuntime: () => ({
    accountKey: "test-account",
    runtime: { voidAllConnections: jest.fn().mockResolvedValue(undefined) },
  }),
}))

const sk = new Uint8Array(32)
sk[31] = 9
const NSEC = nip19.nsecEncode(sk)
const NPUB = nip19.npubEncode(bytesToHex(schnorr.getPublicKey(sk)))

const renderScreen = (
  props: Partial<React.ComponentProps<typeof NostrImportIdentityScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrImportIdentityScreen
        onScan={jest.fn()}
        onDone={jest.fn()}
        onCancel={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("import screen (r3)", () => {
  it("offers a paste input and a scan affordance that routes to the existing scanner", async () => {
    const onScan = jest.fn()
    const { getByTestId } = renderScreen({ onScan })
    await flushEffects()
    expect(getByTestId("nostr-import-paste")).toBeTruthy()
    fireEvent.press(getByTestId("nostr-import-scan"))
    expect(onScan).toHaveBeenCalledTimes(1) // reuses existing scanner via navigation
  })

  it("keeps the CTA disabled until a valid nsec is entered; invalid input shows the inline error", async () => {
    const { getByTestId, queryByTestId } = renderScreen()
    await flushEffects()
    // empty: no error, CTA disabled
    expect(queryByTestId("nostr-import-error")).toBeNull()
    expect(getByTestId("nostr-import-continue").props.accessibilityState?.disabled).toBe(
      true,
    )
    // malformed input: inline error, CTA still disabled, no replace confirm
    fireEvent.changeText(getByTestId("nostr-import-paste"), "not-a-valid-nsec")
    expect(getByTestId("nostr-import-error")).toBeTruthy()
    expect(getByTestId("nostr-import-continue").props.accessibilityState?.disabled).toBe(
      true,
    )
    expect(queryByTestId("nostr-import-confirm-replace")).toBeNull()
  })

  it("rejects a non-secret (npub) with the inline error", async () => {
    const { getByTestId, queryByTestId } = renderScreen()
    await flushEffects()
    fireEvent.changeText(getByTestId("nostr-import-paste"), NPUB)
    expect(getByTestId("nostr-import-error")).toBeTruthy()
    expect(getByTestId("nostr-import-continue").props.accessibilityState?.disabled).toBe(
      true,
    )
    expect(queryByTestId("nostr-import-confirm-replace")).toBeNull()
  })

  it("valid nsec enables Continue and surfaces the consent-danger replace confirm", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    fireEvent.changeText(getByTestId("nostr-import-paste"), NSEC)
    expect(getByTestId("nostr-import-continue").props.accessibilityState?.disabled).toBe(
      false,
    )
    fireEvent.press(getByTestId("nostr-import-continue"))
    await waitFor(() => expect(getByTestId("nostr-import-confirm-replace")).toBeTruthy())
    // both the deliberate destructive control and the cancel are present
    expect(getByTestId("nostr-import-cancel")).toBeTruthy()
  })

  it("a first import (no existing identity) commits directly — no replace confirm", async () => {
    readSecret.mockResolvedValueOnce(null)
    const onDone = jest.fn()
    const { getByTestId, queryByTestId } = renderScreen({ onDone })
    await flushEffects()
    fireEvent.changeText(getByTestId("nostr-import-paste"), NSEC)
    fireEvent.press(getByTestId("nostr-import-continue"))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(queryByTestId("nostr-import-confirm-replace")).toBeNull()
  })

  it("a scanned value feeds validation and never renders the nsec/npub as text", async () => {
    const { queryByText } = renderScreen({ scannedValue: NSEC })
    await flushEffects()
    // neither the nsec nor the npub is shown as visible copy on the import screen
    expect(queryByText(NSEC)).toBeNull()
    expect(queryByText(NPUB)).toBeNull()
  })
})
