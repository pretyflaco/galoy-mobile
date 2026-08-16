/**
 * Story 3.7 Task 1/2 — Connected clients section on the Nostr Identity screen.
 *
 * Lists connected clients (rne-theme rows) with an explicit Disconnect button (not
 * gesture-only). Disconnect opens a {warning}-styled confirm dialog stating the effect;
 * confirm triggers the atomic disconnect, Cancel makes no change. Empty state renders the IA
 * copy. Behavior via testIDs (i18n empty in harness); SR label content enforced by source-scan.
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { NostrConnectedClientsSection } from "@app/screens/nostr/connected-clients-section"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const clients = [
  { clientPubkey: "a".repeat(64), name: "Damus" },
  { clientPubkey: "b".repeat(64), name: "Amethyst" },
]

const renderSection = (
  props: Partial<React.ComponentProps<typeof NostrConnectedClientsSection>> = {},
) =>
  render(
    <ContextForScreen>
      <NostrConnectedClientsSection
        clients={clients}
        onDisconnect={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("connected-clients list (AC #1)", () => {
  it("renders a row per connected client", async () => {
    const { getByTestId } = renderSection()
    await flushEffects()
    expect(getByTestId(`nostr-client-row-${clients[0].clientPubkey}`)).toBeTruthy()
    expect(getByTestId(`nostr-client-row-${clients[1].clientPubkey}`)).toBeTruthy()
  })

  it("shows the empty state when there are no connected clients", async () => {
    const { getByTestId, queryByTestId } = renderSection({ clients: [] })
    await flushEffects()
    expect(getByTestId("nostr-clients-empty")).toBeTruthy()
    expect(queryByTestId(`nostr-client-row-${clients[0].clientPubkey}`)).toBeNull()
  })

  it("each row has an explicit Disconnect button (not gesture-only)", async () => {
    const { getByTestId } = renderSection()
    await flushEffects()
    expect(getByTestId(`nostr-client-disconnect-${clients[0].clientPubkey}`)).toBeTruthy()
  })
})

describe("disconnect confirm dialog (AC #2)", () => {
  it("the Disconnect button opens the confirm dialog (not an immediate disconnect)", async () => {
    const onDisconnect = jest.fn()
    const { getByTestId, queryByTestId } = renderSection({ onDisconnect })
    await flushEffects()
    expect(queryByTestId("nostr-disconnect-confirm")).toBeNull()
    fireEvent.press(getByTestId(`nostr-client-disconnect-${clients[0].clientPubkey}`))
    expect(getByTestId("nostr-disconnect-confirm")).toBeTruthy()
    expect(onDisconnect).not.toHaveBeenCalled() // button opens dialog, does not disconnect
  })

  it("confirming triggers the atomic disconnect for that pubkey", async () => {
    const onDisconnect = jest.fn()
    const { getByTestId } = renderSection({ onDisconnect })
    await flushEffects()
    fireEvent.press(getByTestId(`nostr-client-disconnect-${clients[0].clientPubkey}`))
    fireEvent.press(getByTestId("nostr-disconnect-confirm-yes"))
    expect(onDisconnect).toHaveBeenCalledWith(clients[0].clientPubkey)
  })

  it("cancel makes no state change and closes the dialog", async () => {
    const onDisconnect = jest.fn()
    const { getByTestId, queryByTestId } = renderSection({ onDisconnect })
    await flushEffects()
    fireEvent.press(getByTestId(`nostr-client-disconnect-${clients[0].clientPubkey}`))
    fireEvent.press(getByTestId("nostr-disconnect-confirm-cancel"))
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(queryByTestId("nostr-disconnect-confirm")).toBeNull()
  })

  it("the confirm dialog carries the SR label + accessible affordances", async () => {
    const { getByTestId } = renderSection()
    await flushEffects()
    fireEvent.press(getByTestId(`nostr-client-disconnect-${clients[0].clientPubkey}`))
    const dialog = getByTestId("nostr-disconnect-confirm")
    expect(dialog.props.accessible).toBe(true)
    expect(dialog.props).toHaveProperty("accessibilityLabel")
  })
})
