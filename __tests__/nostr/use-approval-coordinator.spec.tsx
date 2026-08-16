/**
 * Story 3.4 Task 3/5/6 — the coordinator-driven hook exposes the active surface + depth
 * reactively, and approve/reject route through the single coordinator. AppState +
 * AccessibilityInfo are mocked by the RN preset; here we assert the reactive wiring.
 */
import { act, renderHook } from "@testing-library/react-native"

import { useApprovalCoordinator } from "@app/nostr/hooks/use-approval-coordinator"
import {
  createApprovalCoordinator,
  type RequestApprovalEntry,
} from "@app/nostr/approval/coordinator"

const entry = (id: string): RequestApprovalEntry => ({
  id,
  kind: "request",
  clientPubkey: "client-" + id,
  method: "sign_event",
  eventKind: 1,
  humanAction: "sign an event",
  contentPreview: "hello",
})

describe("useApprovalCoordinator (reactive wiring)", () => {
  it("exposes the active entry + depth and updates as the queue drains", () => {
    const coordinator = createApprovalCoordinator({ present: async () => undefined })
    const { result } = renderHook(() => useApprovalCoordinator(coordinator))

    expect(result.current.active).toBeNull()
    expect(result.current.depth).toBe(0)

    act(() => {
      coordinator.enqueue(entry("a"))
      coordinator.enqueue(entry("b"))
    })
    expect(result.current.depth).toBe(2)
    expect(result.current.active?.id).toBe("a")

    act(() => {
      result.current.approve()
    })
    expect(result.current.depth).toBe(1)
    expect(result.current.active?.id).toBe("b")

    act(() => {
      result.current.reject()
    })
    expect(result.current.depth).toBe(0)
    expect(result.current.active).toBeNull()
  })

  it("approve/reject resolve the pending enqueue decision through the coordinator", async () => {
    const coordinator = createApprovalCoordinator({ present: async () => undefined })
    const { result } = renderHook(() => useApprovalCoordinator(coordinator))

    let decision: { approved: boolean } | undefined
    act(() => {
      coordinator.enqueue(entry("a")).then((d) => {
        decision = d
      })
    })
    act(() => {
      result.current.approve()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(decision).toMatchObject({ approved: true })
  })
})
