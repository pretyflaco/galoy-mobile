/**
 * Story 3.1 — the single bounded-wait UI (Task 3/4/6, native rne-theme).
 *
 * One component renders the machine's phases for connect / session / request. Because the
 * ContextForScreen harness loads i18n async (copy is empty in tests), behavior is asserted
 * via testIDs (testProps), never rendered copy. A separate source-scan test enforces that
 * every string is i18n-sourced.
 *
 * The component is a THIN binding: the phase is driven by the injected machine snapshot, so
 * the test drives phases by controlling `phase` directly rather than wall-clock timers.
 */
import React from "react"
import { render, fireEvent } from "@testing-library/react-native"

import { BoundedWaitView } from "@app/screens/nostr/bounded-wait-view"

import { ContextForScreen } from "../screens/helper"
import { flushEffects } from "../helpers/flush-effects"

const renderView = (props: Partial<React.ComponentProps<typeof BoundedWaitView>> = {}) =>
  render(
    <ContextForScreen>
      <BoundedWaitView
        phase="waiting"
        exit="cancel"
        canExtend={false}
        onTryAgain={jest.fn()}
        onExit={jest.fn()}
        onExtend={jest.fn()}
        {...props}
      />
    </ContextForScreen>,
  )

describe("BoundedWaitView (Task 3)", () => {
  it("shows the waiting indicator in the waiting phase", async () => {
    const { getByTestId, queryByTestId } = renderView({ phase: "waiting" })
    await flushEffects()
    expect(getByTestId("nostr-bounded-wait-waiting")).toBeTruthy()
    expect(queryByTestId("nostr-bounded-wait-timeout")).toBeNull()
  })

  it("shows the slow-connection hint before timeout", async () => {
    const { getByTestId } = renderView({ phase: "slow-connection", canExtend: true })
    await flushEffects()
    expect(getByTestId("nostr-bounded-wait-slow")).toBeTruthy()
    // "I need more time" is offered BEFORE the timeout fires
    expect(getByTestId("nostr-bounded-wait-extend")).toBeTruthy()
  })

  it("at timeout renders Try Again + the context exit (cancel for a general stage)", async () => {
    const onTryAgain = jest.fn()
    const onExit = jest.fn()
    const { getByTestId } = renderView({
      phase: "timeout",
      exit: "cancel",
      onTryAgain,
      onExit,
    })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-bounded-wait-try-again"))
    fireEvent.press(getByTestId("nostr-bounded-wait-exit"))
    expect(onTryAgain).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it("uses the sign-out exit for an authenticated stage", async () => {
    const { getByTestId } = renderView({ phase: "timeout", exit: "sign-out" })
    await flushEffects()
    // the single exit control is present; its variant is driven by the exit prop
    expect(getByTestId("nostr-bounded-wait-exit")).toBeTruthy()
  })

  it("invokes onExtend when 'I need more time' is pressed", async () => {
    const onExtend = jest.fn()
    const { getByTestId } = renderView({
      phase: "slow-connection",
      canExtend: true,
      onExtend,
    })
    await flushEffects()
    fireEvent.press(getByTestId("nostr-bounded-wait-extend"))
    expect(onExtend).toHaveBeenCalledTimes(1)
  })
})
