/**
 * ApprovalSurfaceHost — render-from-state overlay (the fix for the stale-route + dead-reject
 * bugs). The host is NO LONGER a navigator that pushes/pops approval routes; it renders the
 * active coordinator surface inside a full-screen Modal. Approve/Reject resolve the coordinator,
 * which clears the active entry and hides the surface — no navigate/goBack pair to desync.
 *
 * These tests assert the RENDERED surface for each active entry + the burst threshold routing,
 * and the ONE deliberate navigation (connection approve → Connected clients).
 */
import React from "react"
import { AppState } from "react-native"
import { render, waitFor, fireEvent } from "@testing-library/react-native"

// Force the presentation gate open (android-parity): jest reports ios + unknown appstate, which
// would suppress presentation.
;(AppState as unknown as { currentState: string }).currentState = "active"

const navigate = jest.fn()
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate, goBack: jest.fn(), canGoBack: () => true }),
}))

import {
  createApprovalCoordinator,
  type ApprovalCoordinator,
} from "@app/nostr/approval/coordinator"

let testCoordinator: ApprovalCoordinator
// A mutable awaiting-followup state the tests can set; the store reads it live so a re-render
// (driven by the coordinator subscription) reflects it.
let testAwaiting: { clientPubkey: string; name?: string; image?: string } | null = null
jest.mock("@app/nostr/nostr-runtime-provider", () => ({
  useNostrRuntime: () => ({
    coordinator: testCoordinator,
    enabled: true,
    runtime: {
      listConnections: async () => [],
      duplicatePrompt: {
        subscribe: () => () => undefined,
        current: () => null,
        prompt: async () => "cancel",
      },
      awaitingFollowup: {
        subscribe: (cb: () => void) => testCoordinator.subscribe(cb),
        current: () => testAwaiting,
        set: () => undefined,
        clear: () => undefined,
      },
    },
  }),
}))

import { ApprovalSurfaceHost } from "@app/nostr/approval-surface-host"

import { ContextForScreen } from "../screens/helper"

const renderHost = () =>
  render(
    <ContextForScreen>
      <ApprovalSurfaceHost />
    </ContextForScreen>,
  )

beforeEach(() => {
  navigate.mockClear()
  testAwaiting = null
  testCoordinator = createApprovalCoordinator({ present: async () => undefined })
})

describe("ApprovalSurfaceHost (render-from-state overlay)", () => {
  it("renders NOTHING when there is no active entry", async () => {
    const { queryByTestId } = renderHost()
    await waitFor(() => {
      expect(queryByTestId("nostr-connection-approval")).toBeNull()
      expect(queryByTestId("nostr-request-approval")).toBeNull()
      expect(queryByTestId("nostr-review-all")).toBeNull()
    })
  })

  it("renders the CONNECTION approval surface for a connection entry", async () => {
    const { queryByTestId } = renderHost()
    testCoordinator.enqueue({
      id: "c1",
      kind: "connection",
      clientPubkey: "c1",
      metadata: { name: "BTCPay Server" },
    })
    await waitFor(() => expect(queryByTestId("nostr-connection-approval")).toBeTruthy())
  })

  it("renders the REQUEST approval surface for a single request entry", async () => {
    const { queryByTestId } = renderHost()
    testCoordinator.enqueue({
      id: "r1",
      kind: "request",
      clientPubkey: "c2",
      method: "nip44_decrypt",
      humanAction: "decrypt a message",
    })
    await waitFor(() => expect(queryByTestId("nostr-request-approval")).toBeTruthy())
    expect(queryByTestId("nostr-review-all")).toBeNull()
  })

  it("CONNECTION approve resolves + navigates to the client's Activity screen (from the hub base)", async () => {
    const { getByTestId } = renderHost()
    const decision = testCoordinator.enqueue({
      id: "c3",
      kind: "connection",
      clientPubkey: "c3",
      metadata: { name: "BTCPay Server" },
    })
    await waitFor(() => expect(getByTestId("nostr-connection-approve")).toBeTruthy())
    fireEvent.press(getByTestId("nostr-connection-approve"))
    await expect(decision).resolves.toEqual({ approved: true, epoch: 0 })
    expect(navigate).toHaveBeenCalledWith("nostrActivity", { clientPubkey: "c3" })
  })

  it("REJECT resolves the connection and dismisses the surface (no navigation)", async () => {
    const { getByTestId, queryByTestId } = renderHost()
    const decision = testCoordinator.enqueue({
      id: "c4",
      kind: "connection",
      clientPubkey: "c4",
      metadata: {},
    })
    await waitFor(() => expect(getByTestId("nostr-connection-reject")).toBeTruthy())
    fireEvent.press(getByTestId("nostr-connection-reject"))
    await expect(decision).resolves.toEqual({ approved: false, epoch: 0 })
    // Surface is gone (state cleared) and reject never navigates.
    await waitFor(() => expect(queryByTestId("nostr-connection-approval")).toBeNull())
    expect(navigate).not.toHaveBeenCalled()
  })

  it("renders the REVIEW-ALL burst surface when one client has 3+ pending requests (B5)", async () => {
    const { queryByTestId } = renderHost()
    for (const id of ["b1", "b2", "b3"]) {
      testCoordinator.enqueue({
        id,
        kind: "request",
        clientPubkey: "burst-client",
        method: "nip44_decrypt",
        humanAction: "decrypt a message",
      })
    }
    await waitFor(() => expect(queryByTestId("nostr-review-all")).toBeTruthy())
    expect(queryByTestId("nostr-request-approval")).toBeNull()
  })

  it("still renders the single request surface below the burst threshold (2 pending)", async () => {
    const { queryByTestId } = renderHost()
    for (const id of ["t1", "t2"]) {
      testCoordinator.enqueue({
        id,
        kind: "request",
        clientPubkey: "small-client",
        method: "nip44_decrypt",
        humanAction: "decrypt a message",
      })
    }
    await waitFor(() => expect(queryByTestId("nostr-request-approval")).toBeTruthy())
    expect(queryByTestId("nostr-review-all")).toBeNull()
  })
})

describe("ApprovalSurfaceHost — sign-in waiting overlay", () => {
  it("shows the waiting surface when awaitingFollowup is set and no approval is active", async () => {
    testAwaiting = { clientPubkey: "w1", name: "BTCPay Server" }
    const { queryByTestId } = renderHost()
    // Nudge a coordinator notify so the store subscription re-reads (no active entry enqueued).
    testCoordinator.enqueue({
      id: "nudge",
      kind: "request",
      clientPubkey: "other",
      method: "nip44_decrypt",
      humanAction: "decrypt a message",
    })
    // The nudge itself becomes active → waiting suppressed. Resolve it to clear active.
    await waitFor(() => expect(queryByTestId("nostr-request-approval")).toBeTruthy())
    testCoordinator.resolveActive({ approved: false })
    await waitFor(() => expect(queryByTestId("nostr-awaiting-followup")).toBeTruthy())
  })

  it("suppresses the waiting surface while an approval IS active (approval takes precedence)", async () => {
    testAwaiting = { clientPubkey: "w2", name: "BTCPay Server" }
    const { queryByTestId } = renderHost()
    testCoordinator.enqueue({
      id: "req",
      kind: "request",
      clientPubkey: "w2",
      method: "nip44_decrypt",
      humanAction: "decrypt a message",
    })
    await waitFor(() => expect(queryByTestId("nostr-request-approval")).toBeTruthy())
    // The request approval owns the screen; the waiting surface is not shown underneath it.
    expect(queryByTestId("nostr-awaiting-followup")).toBeNull()
  })
})
