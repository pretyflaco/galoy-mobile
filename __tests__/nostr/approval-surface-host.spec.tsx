/**
 * Story A6 — ApprovalSurfaceHost (the presenter that was missing).
 *
 * This is the regression guard for the on-device bug where scanning a nostrconnect:// QR did
 * "nothing": the ConnectFlow enqueued a connection on the coordinator, but NO component rendered
 * the coordinator's activeEntry, so the approval surface never appeared and the request waited
 * forever. The A5 integration test missed it because it drove the coordinator with a FAKE present
 * that auto-resolved. This test uses the REAL host + REAL coordinator: enqueue -> assert the
 * surface renders -> approve/reject -> assert coordinator.resolveActive fired.
 */
import React from "react"
import { AppState } from "react-native"
import { render, fireEvent, waitFor } from "@testing-library/react-native"

// The presentation gate (shouldPresentNow) shows a surface on android unconditionally, and on
// ios only when the app is "active". jest reports Platform.OS as "ios" and AppState as unknown,
// which would suppress the surface; force AppState "active" so the on-device present path is
// exercised (equivalent to a foregrounded phone).
;(AppState as unknown as { currentState: string }).currentState = "active"

// The host reads the coordinator from the runtime context; mock the context to hand it our
// real coordinator (so we exercise the host + hook + screens, not the whole provider stack).
import {
  createApprovalCoordinator,
  type ApprovalCoordinator,
} from "@app/nostr/approval/coordinator"

let testCoordinator: ApprovalCoordinator
jest.mock("@app/nostr/nostr-runtime-provider", () => ({
  useNostrRuntime: () => ({ coordinator: testCoordinator, enabled: true, runtime: {} }),
}))

import { ApprovalSurfaceHost } from "@app/nostr/approval-surface-host"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderHost = () =>
  render(
    <ContextForScreen>
      <ApprovalSurfaceHost />
    </ContextForScreen>,
  )

beforeEach(() => {
  // A real coordinator with a no-op present (the HOST is what presents now, not the port).
  testCoordinator = createApprovalCoordinator({ present: async () => undefined })
})

describe("ApprovalSurfaceHost (A6 — the missing presenter)", () => {
  it("renders NOTHING when the coordinator has no active entry", async () => {
    const { queryByTestId } = renderHost()
    await flushEffects()
    expect(queryByTestId("nostr-connection-approve")).toBeNull()
    expect(queryByTestId("nostr-request-approve")).toBeNull()
  })

  it("renders the CONNECTION approval surface when a connection entry is enqueued", async () => {
    const { getByTestId } = renderHost()
    // Enqueue a connection (what ConnectFlow does after a scanned nostrconnect:// URI).
    testCoordinator.enqueue({
      id: "client-1",
      kind: "connection",
      clientPubkey: "client-1",
      metadata: { name: "BTCPay Server" },
    })
    await waitFor(() => {
      expect(getByTestId("nostr-connection-approve")).toBeTruthy()
      expect(getByTestId("nostr-connection-reject")).toBeTruthy()
    })
  })

  it("Approve resolves the coordinator's active entry (approved=true)", async () => {
    const { getByTestId } = renderHost()
    const decision = testCoordinator.enqueue({
      id: "client-2",
      kind: "connection",
      clientPubkey: "client-2",
      metadata: { name: "BTCPay Server" },
    })
    await waitFor(() => expect(getByTestId("nostr-connection-approve")).toBeTruthy())

    fireEvent.press(getByTestId("nostr-connection-approve"))
    await expect(decision).resolves.toMatchObject({ approved: true })
  })

  it("Reject resolves the coordinator's active entry (approved=false)", async () => {
    const { getByTestId } = renderHost()
    const decision = testCoordinator.enqueue({
      id: "client-3",
      kind: "connection",
      clientPubkey: "client-3",
      metadata: {},
    })
    await waitFor(() => expect(getByTestId("nostr-connection-reject")).toBeTruthy())

    fireEvent.press(getByTestId("nostr-connection-reject"))
    await expect(decision).resolves.toMatchObject({ approved: false })
  })

  it("renders the REQUEST approval surface for a request entry (sign/decrypt)", async () => {
    const { getByTestId } = renderHost()
    testCoordinator.enqueue({
      id: "req-1",
      kind: "request",
      clientPubkey: "client-4",
      method: "nip44_decrypt",
      humanAction: "decrypt a message",
      contentPreview: "hello",
    })
    await waitFor(() => {
      expect(getByTestId("nostr-request-approve")).toBeTruthy()
      expect(getByTestId("nostr-request-reject")).toBeTruthy()
    })
  })
})
