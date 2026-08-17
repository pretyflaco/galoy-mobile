/**
 * Story A6 / fix #1 — ApprovalSurfaceHost is now a HEADLESS navigator: on an active+visible
 * coordinator entry it navigates to a FULL-SCREEN approval route (not a modal overlay), and pops
 * when the entry resolves. This guards the regression where scanning did "nothing" (no presenter)
 * AND the fix where the approval must be a proper screen, not an overlay over the camera.
 */
import React from "react"
import { AppState } from "react-native"
import { render, waitFor } from "@testing-library/react-native"

// Force the presentation gate open (android-parity): jest reports ios + unknown appstate, which
// would suppress presentation.
;(AppState as unknown as { currentState: string }).currentState = "active"

const navigate = jest.fn()
const goBack = jest.fn()
const canGoBack = jest.fn(() => true)
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate, goBack, canGoBack }),
}))

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

const renderHost = () =>
  render(
    <ContextForScreen>
      <ApprovalSurfaceHost />
    </ContextForScreen>,
  )

beforeEach(() => {
  navigate.mockClear()
  goBack.mockClear()
  testCoordinator = createApprovalCoordinator({ present: async () => undefined })
})

describe("ApprovalSurfaceHost (A6 fix #1 — full-screen route, not overlay)", () => {
  it("navigates nowhere when there is no active entry", async () => {
    renderHost()
    await waitFor(() => expect(navigate).not.toHaveBeenCalled())
  })

  it("navigates to the CONNECTION approval route on a connection entry", async () => {
    renderHost()
    testCoordinator.enqueue({
      id: "c1",
      kind: "connection",
      clientPubkey: "c1",
      metadata: { name: "BTCPay Server" },
    })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("nostrConnectionApproval"))
  })

  it("navigates to the REQUEST approval route on a request entry", async () => {
    renderHost()
    testCoordinator.enqueue({
      id: "r1",
      kind: "request",
      clientPubkey: "c2",
      method: "nip44_decrypt",
      humanAction: "decrypt a message",
    })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("nostrRequestApproval"))
  })

  it("pops a REQUEST route when the active entry resolves (requests have no landing screen)", async () => {
    renderHost()
    const decision = testCoordinator.enqueue({
      id: "r3",
      kind: "request",
      clientPubkey: "c3",
      method: "nip44_decrypt",
      humanAction: "decrypt a message",
    })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("nostrRequestApproval"))

    testCoordinator.resolveActive({ approved: true })
    await decision
    await waitFor(() => expect(goBack).toHaveBeenCalledTimes(1))
  })

  it("does NOT auto-pop a CONNECTION route on resolve (the route self-navigates)", async () => {
    renderHost()
    const decision = testCoordinator.enqueue({
      id: "c4",
      kind: "connection",
      clientPubkey: "c4",
      metadata: {},
    })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("nostrConnectionApproval"))

    // Resolving a connection must NOT trigger a host goBack — the approval route drives its own
    // navigation (approve → Connected clients, reject → back), avoiding a double-navigate.
    testCoordinator.resolveActive({ approved: true })
    await decision
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(goBack).not.toHaveBeenCalled()
  })
})
