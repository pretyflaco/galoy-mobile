/**
 * Nostr Identity Hub (redesign r3, spec §7.5).
 *
 * Empty-state (Create or import) vs. summary. The summary shows the backup banner while
 * un-backed-up, the profile hero (kind-0 avatar or identicon + pencil), the public
 * address with copy + QR, the INLINE connected-apps list with revoke, and Scan as the
 * primary action. Settings lives on the header gear (route wrapper, not this component).
 * The nsec is never rendered. Behavior is asserted via testIDs (the harness renders i18n
 * copy empty).
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrIdentityHubScreen } from "@app/screens/nostr/identity-hub/nostr-identity-hub-screen"
import type { ConnectedClient } from "@app/screens/nostr/connected-clients-section"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const NPUB = "npub1" + "q".repeat(58)
const PUBKEY = "a".repeat(64)

const CLIENT: ConnectedClient = {
  clientPubkey: "c".repeat(64),
  name: "BTCPay Server",
  createdAt: 1757437200,
}

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
        clients={[]}
        onClientPress={jest.fn()}
        onDisconnect={jest.fn()}
        onScan={jest.fn()}
        showBackupBanner={false}
        onBackup={jest.fn()}
        onAddPhoto={jest.fn()}
        photoBusy={false}
        {...props}
      />
    </ContextForScreen>,
  )

describe("Nostr Identity Hub (r3)", () => {
  it("renders the Create-or-import empty state when no identity exists", async () => {
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

  it("summary shows hero + public address + inline connected apps + Scan primary", async () => {
    const { getByTestId, queryByTestId } = renderHub({ npub: NPUB, pubkeyHex: PUBKEY })
    await flushEffects()
    expect(getByTestId("nostr-identity-hub-summary")).toBeTruthy()
    expect(getByTestId("nostr-identity-add-photo")).toBeTruthy()
    expect(getByTestId("nostr-identity-copy-npub")).toBeTruthy()
    expect(getByTestId("nostr-identity-show-qr")).toBeTruthy()
    // Scan is the Hub's primary action (deliberate duplicate of the Home scanner).
    expect(getByTestId("nostr-identity-scan")).toBeTruthy()
    // Empty connected-apps surface ("No apps connected yet.")
    expect(getByTestId("nostr-clients-empty")).toBeTruthy()
    // The old full-width Connected clients / Settings buttons are gone (gear is in the header).
    expect(queryByTestId("nostr-identity-connected-clients")).toBeNull()
    expect(queryByTestId("nostr-identity-settings")).toBeNull()
    // No banner unless the identity is un-backed-up
    expect(queryByTestId("nostr-identity-backup-banner")).toBeNull()
  })

  it("shows the backup banner while un-backed-up and routes to the backup flow on tap", async () => {
    const onBackup = jest.fn()
    const { getByTestId } = renderHub({
      npub: NPUB,
      pubkeyHex: PUBKEY,
      showBackupBanner: true,
      onBackup,
    })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-identity-backup-banner"))
    expect(onBackup).toHaveBeenCalledTimes(1)
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

  it("shows the npub truncated; the full value only in the QR modal (nsec never rendered)", async () => {
    const { getByTestId, queryByText } = renderHub({ npub: NPUB, pubkeyHex: PUBKEY })
    await flushEffects()
    expect(queryByText(NPUB)).toBeNull()
    expect(getByTestId("nostr-identity-npub").props.children).toContain("...")
  })

  it("opens the public-address QR modal from the QR card", async () => {
    const { getByTestId } = renderHub({ npub: NPUB, pubkeyHex: PUBKEY })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-identity-show-qr"))
    expect(getByTestId("nostr-identity-qr-close")).toBeTruthy()
  })

  it("lists connected apps inline; row tap opens activity, trash revokes with a confirm", async () => {
    const onClientPress = jest.fn()
    const onDisconnect = jest.fn()
    const { getByTestId, queryByTestId } = renderHub({
      npub: NPUB,
      pubkeyHex: PUBKEY,
      clients: [CLIENT],
      onClientPress,
      onDisconnect,
    })
    await flushEffects()
    expect(queryByTestId("nostr-clients-empty")).toBeNull()
    fireEvent.press(getByTestId(`nostr-client-row-${CLIENT.clientPubkey}`))
    expect(onClientPress).toHaveBeenCalledWith(CLIENT.clientPubkey)
    // revoke goes through the warning confirm before disconnecting
    fireEvent.press(getByTestId(`nostr-client-disconnect-${CLIENT.clientPubkey}`))
    expect(getByTestId("nostr-disconnect-confirm")).toBeTruthy()
    expect(onDisconnect).not.toHaveBeenCalled()
    fireEvent.press(getByTestId("nostr-disconnect-confirm-yes"))
    expect(onDisconnect).toHaveBeenCalledWith(CLIENT.clientPubkey)
  })

  it("routes Scan to the shared scanner", async () => {
    const onScan = jest.fn()
    const { getByTestId } = renderHub({ npub: NPUB, pubkeyHex: PUBKEY, onScan })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-identity-scan"))
    expect(onScan).toHaveBeenCalledTimes(1)
  })

  it("renders a loading state without empty/summary while reading the keystore", async () => {
    const { getByTestId, queryByTestId } = renderHub({ loading: true, npub: null })
    expect(getByTestId("nostr-identity-hub-loading")).toBeTruthy()
    expect(queryByTestId("nostr-identity-hub-empty")).toBeNull()
    expect(queryByTestId("nostr-identity-hub-summary")).toBeNull()
  })
})
