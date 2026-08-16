/**
 * Story A2 — Nostr Identity hub screen (settings entry).
 *
 * Decides empty-state (no identity → create/import) vs. summary (identity exists → scan,
 * connected clients, backup, replace). Navigation-agnostic: routing is via injected callbacks.
 * The nsec is never rendered; only the public npub appears (truncated, tap-to-reveal). Behavior
 * is asserted via testIDs (the ContextForScreen harness renders i18n copy empty).
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrIdentityHubScreen } from "@app/screens/nostr/identity-hub/nostr-identity-hub-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const NPUB = "npub1" + "q".repeat(58)

const renderHub = (
  props: Partial<React.ComponentProps<typeof NostrIdentityHubScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrIdentityHubScreen
        npub={null}
        loading={false}
        onCreate={jest.fn()}
        onImport={jest.fn()}
        onBackup={jest.fn()}
        onReplace={jest.fn()}
        onConnectedClients={jest.fn()}
        onScanToConnect={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("Nostr Identity hub (A2)", () => {
  it("renders the empty-state with create + import when no identity exists", async () => {
    const { getByTestId, queryByTestId } = renderHub({ npub: null })
    await flushEffects()
    expect(getByTestId("nostr-identity-hub-empty")).toBeTruthy()
    expect(getByTestId("nostr-identity-create")).toBeTruthy()
    expect(getByTestId("nostr-identity-import")).toBeTruthy()
    expect(queryByTestId("nostr-identity-hub-summary")).toBeNull()
  })

  it("routes create + import from the empty-state", async () => {
    const onCreate = jest.fn()
    const onImport = jest.fn()
    const { getByTestId } = renderHub({ npub: null, onCreate, onImport })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-identity-create"))
    fireEvent.press(getByTestId("nostr-identity-import"))
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onImport).toHaveBeenCalledTimes(1)
  })

  it("renders the summary with the management actions when an identity exists", async () => {
    const { getByTestId, queryByTestId } = renderHub({ npub: NPUB })
    await flushEffects()
    expect(getByTestId("nostr-identity-hub-summary")).toBeTruthy()
    expect(getByTestId("nostr-identity-scan-to-connect")).toBeTruthy()
    expect(getByTestId("nostr-identity-connected-clients")).toBeTruthy()
    expect(getByTestId("nostr-identity-backup")).toBeTruthy()
    expect(getByTestId("nostr-identity-replace")).toBeTruthy()
    expect(queryByTestId("nostr-identity-hub-empty")).toBeNull()
  })

  it("shows the npub truncated and reveals the full value on tap (nsec never rendered)", async () => {
    const { getByTestId, queryByText } = renderHub({ npub: NPUB })
    await flushEffects()
    // Full npub is not shown until revealed.
    expect(queryByText(NPUB)).toBeNull()
    fireEvent.press(getByTestId("nostr-identity-npub"))
    expect(getByTestId("nostr-identity-npub")).toBeTruthy()
  })

  it("routes each management action", async () => {
    const onScanToConnect = jest.fn()
    const onConnectedClients = jest.fn()
    const onBackup = jest.fn()
    const onReplace = jest.fn()
    const { getByTestId } = renderHub({
      npub: NPUB,
      onScanToConnect,
      onConnectedClients,
      onBackup,
      onReplace,
    })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-identity-scan-to-connect"))
    fireEvent.press(getByTestId("nostr-identity-connected-clients"))
    fireEvent.press(getByTestId("nostr-identity-backup"))
    fireEvent.press(getByTestId("nostr-identity-replace"))
    expect(onScanToConnect).toHaveBeenCalledTimes(1)
    expect(onConnectedClients).toHaveBeenCalledTimes(1)
    expect(onBackup).toHaveBeenCalledTimes(1)
    expect(onReplace).toHaveBeenCalledTimes(1)
  })

  it("renders a loading state without empty/summary while reading the keystore", async () => {
    const { getByTestId, queryByTestId } = renderHub({ loading: true, npub: null })
    expect(getByTestId("nostr-identity-hub-loading")).toBeTruthy()
    expect(queryByTestId("nostr-identity-hub-empty")).toBeNull()
    expect(queryByTestId("nostr-identity-hub-summary")).toBeNull()
  })
})
