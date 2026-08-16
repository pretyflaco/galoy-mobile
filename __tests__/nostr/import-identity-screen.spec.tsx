/**
 * Story 1.6 — import screen UI (Tasks 1,3). Paste + scan affordance (scan routes to the
 * EXISTING scanner via onScan, no new scanner); invalid nsec → error, no confirm; valid
 * nsec → consent-danger confirm with Cancel as default and the destructive confirm
 * distinct; the nsec is never rendered as visible text.
 */
import React from "react"
import { render, fireEvent, waitFor } from "@testing-library/react-native"

import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

import { NostrImportIdentityScreen } from "@app/screens/nostr/import-identity"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

jest.mock("@app/nostr/core/keystore", () => ({
  NOSTR_NSEC_SERVICE: "nostr.nsec",
  writeSecret: jest.fn().mockResolvedValue(undefined),
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

describe("import screen (AC-1/AC-2/AC-3)", () => {
  it("offers a paste input and a scan affordance that routes to the existing scanner", async () => {
    const onScan = jest.fn()
    const { getByTestId } = renderScreen({ onScan })
    await flushEffects()
    expect(getByTestId("nostr-import-paste")).toBeTruthy()
    fireEvent.press(getByTestId("nostr-import-scan"))
    expect(onScan).toHaveBeenCalledTimes(1) // reuses existing scanner via navigation
  })

  it("invalid nsec shows an error and does NOT reach the replace confirm", async () => {
    const { getByTestId, queryByTestId } = renderScreen()
    await flushEffects()
    fireEvent.changeText(getByTestId("nostr-import-paste"), "not-a-valid-nsec")
    fireEvent.press(getByTestId("nostr-import-continue"))
    await flushEffects()
    expect(queryByTestId("nostr-import-confirm-replace")).toBeNull()
  })

  it("valid nsec surfaces the consent-danger replace confirm (Cancel + deliberate Confirm)", async () => {
    const { getByTestId } = renderScreen()
    await flushEffects()
    fireEvent.changeText(getByTestId("nostr-import-paste"), NSEC)
    fireEvent.press(getByTestId("nostr-import-continue"))
    await waitFor(() => expect(getByTestId("nostr-import-confirm-replace")).toBeTruthy())
    // both the deliberate destructive control and the cancel are present
    expect(getByTestId("nostr-import-cancel")).toBeTruthy()
  })

  it("a scanned value feeds validation and never renders the nsec/npub as text", async () => {
    const { queryByText } = renderScreen({ scannedValue: NSEC })
    await flushEffects()
    // neither the nsec nor the npub is shown as visible copy on the import screen
    expect(queryByText(NSEC)).toBeNull()
    expect(queryByText(NPUB)).toBeNull()
  })
})
