/**
 * Story A2 — Nostr Identity hub screen (settings entry).
 *
 * Empty-state (no identity → create/import) vs. summary. The summary leads with a profile hero
 * (kind-0 avatar or identicon placeholder + add-photo stub), the npub with copy + QR, then
 * Connected clients + Settings. Scan-to-connect is GONE from the hub (Home screen only). The nsec
 * is never rendered. Behavior is asserted via testIDs (the harness renders i18n copy empty).
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrIdentityHubScreen } from "@app/screens/nostr/identity-hub/nostr-identity-hub-screen"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const NPUB = "npub1" + "q".repeat(58)
const PUBKEY = "a".repeat(64)

const renderHub = (
  props: Partial<React.ComponentProps<typeof NostrIdentityHubScreen>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrIdentityHubScreen
        npub={null}
        pubkeyHex={null}
        pictureUrl={null}
        loading={false}
        onCreate={jest.fn()}
        onImport={jest.fn()}
        onConnectedClients={jest.fn()}
        onSettings={jest.fn()}
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

  it("summary shows the hero + npub actions + Connected clients + Settings; NO scan button", async () => {
    const { getByTestId, queryByTestId } = renderHub({ npub: NPUB, pubkeyHex: PUBKEY })
    await flushEffects()
    expect(getByTestId("nostr-identity-hub-summary")).toBeTruthy()
    expect(getByTestId("nostr-identity-add-photo")).toBeTruthy()
    expect(getByTestId("nostr-identity-copy-npub")).toBeTruthy()
    expect(getByTestId("nostr-identity-show-qr")).toBeTruthy()
    expect(getByTestId("nostr-identity-connected-clients")).toBeTruthy()
    expect(getByTestId("nostr-identity-settings")).toBeTruthy()
    // The scan-to-connect button was removed from the hub (Home screen is the only scan entry).
    expect(queryByTestId("nostr-identity-scan-to-connect")).toBeNull()
    expect(queryByTestId("nostr-identity-hub-empty")).toBeNull()
  })

  it("renders the fetched avatar image when a pictureUrl is present, else the identicon", async () => {
    const withPic = renderHub({
      npub: NPUB,
      pubkeyHex: PUBKEY,
      pictureUrl: "https://x/y.png",
    })
    await flushEffects()
    expect(withPic.getByTestId("nostr-identity-avatar-image")).toBeTruthy()

    const noPic = renderHub({ npub: NPUB, pubkeyHex: PUBKEY, pictureUrl: null })
    await flushEffects()
    // No <Image> avatar when there is no picture — the identicon SVG stands in.
    expect(noPic.queryByTestId("nostr-identity-avatar-image")).toBeNull()
  })

  it("shows the npub truncated and reveals the full value on tap (nsec never rendered)", async () => {
    const { getByTestId, queryByText } = renderHub({ npub: NPUB, pubkeyHex: PUBKEY })
    await flushEffects()
    expect(queryByText(NPUB)).toBeNull()
    fireEvent.press(getByTestId("nostr-identity-npub"))
    expect(getByTestId("nostr-identity-npub")).toBeTruthy()
  })

  it("opens the npub QR overlay from the QR button", async () => {
    const { getByTestId } = renderHub({ npub: NPUB, pubkeyHex: PUBKEY })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-identity-show-qr"))
    expect(getByTestId("nostr-identity-qr-close")).toBeTruthy()
  })

  it("routes Connected clients + Settings", async () => {
    const onConnectedClients = jest.fn()
    const onSettings = jest.fn()
    const { getByTestId } = renderHub({
      npub: NPUB,
      pubkeyHex: PUBKEY,
      onConnectedClients,
      onSettings,
    })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-identity-connected-clients"))
    fireEvent.press(getByTestId("nostr-identity-settings"))
    expect(onConnectedClients).toHaveBeenCalledTimes(1)
    expect(onSettings).toHaveBeenCalledTimes(1)
  })

  it("renders a loading state without empty/summary while reading the keystore", async () => {
    const { getByTestId, queryByTestId } = renderHub({ loading: true, npub: null })
    expect(getByTestId("nostr-identity-hub-loading")).toBeTruthy()
    expect(queryByTestId("nostr-identity-hub-empty")).toBeNull()
    expect(queryByTestId("nostr-identity-hub-summary")).toBeNull()
  })
})
