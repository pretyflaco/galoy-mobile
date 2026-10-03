/**
 * Story 3.1 — the single bounded-wait pattern (AD-11 / AD-16 / NFR-7 / WCAG 2.2.1).
 *
 * One state machine drives connect / session-establishment / request handling identically:
 *   waiting → slow-connection (BEFORE timeout) → timeout → Try Again + context exit.
 * Task 3: slow-connection strictly precedes timeout; the timeout surface offers Try Again
 *         plus a context-appropriate exit ("cancel" general, "sign-out" authenticated); no
 *         waiting state lacks a bounded terminal.
 * Task 4: Try Again fully resets the stage AND re-triggers the underlying request.
 * Task 6: the timer PAUSES while an approval surface holds focus (decision time off the
 *         clock) and RESUMES on blur; an "I need more time" extension is offered before an
 *         unavoidable timeout and extends the stage when accepted.
 *
 * Framework-agnostic (transport, AD-1): a fake clock drives elapsed time — no RN, no timers.
 */
import {
  createBoundedWait,
  type BoundedWaitExit,
} from "../../app/nostr/transport/bounded-wait"
import { STAGE_TIMEOUT_MS, SLOW_CONNECTION_HINT_MS } from "../../app/nostr/config"

const makeMachine = (exit: BoundedWaitExit = "cancel") =>
  createBoundedWait({
    stageMs: STAGE_TIMEOUT_MS,
    slowHintMs: SLOW_CONNECTION_HINT_MS,
    exit,
  })

describe("bounded-wait state machine: waiting → slow → timeout (AD-11 / Task 3)", () => {
  it("starts in 'waiting' and enters 'slow-connection' BEFORE the timeout fires", () => {
    const m = makeMachine()
    m.start()
    expect(m.snapshot().phase).toBe("waiting")

    m.tick(SLOW_CONNECTION_HINT_MS)
    expect(m.snapshot().phase).toBe("slow-connection") // slow hint precedes timeout

    // slow must be entered strictly before the stage timeout
    expect(SLOW_CONNECTION_HINT_MS).toBeLessThan(STAGE_TIMEOUT_MS)
  })

  it("reaches 'timeout' only at/after the stage bound", () => {
    const m = makeMachine()
    m.start()
    m.tick(STAGE_TIMEOUT_MS - 1)
    expect(m.snapshot().phase).toBe("slow-connection")
    m.tick(1)
    expect(m.snapshot().phase).toBe("timeout")
  })

  it("the timeout surface offers Try Again + a context-appropriate exit", () => {
    const general = makeMachine("cancel")
    general.start()
    general.tick(STAGE_TIMEOUT_MS)
    expect(general.snapshot()).toMatchObject({
      phase: "timeout",
      canTryAgain: true,
      exit: "cancel",
    })

    const authed = makeMachine("sign-out")
    authed.start()
    authed.tick(STAGE_TIMEOUT_MS)
    expect(authed.snapshot().exit).toBe("sign-out")
  })

  it("no waiting state is without a bounded terminal (NFR-7: no infinite spinner)", () => {
    const m = makeMachine()
    m.start()
    // advancing well past every bound always lands on a terminal, never stuck waiting
    m.tick(STAGE_TIMEOUT_MS * 10)
    expect(m.snapshot().phase).toBe("timeout")
    expect(m.snapshot().isTerminal).toBe(true)
  })
})

describe("Try Again — full stage reset + re-trigger (Task 4)", () => {
  it("resets phase to 'waiting', clears elapsed, and re-triggers the request", () => {
    const retrigger = jest.fn()
    const m = createBoundedWait({
      stageMs: STAGE_TIMEOUT_MS,
      slowHintMs: SLOW_CONNECTION_HINT_MS,
      exit: "cancel",
      onRetrigger: retrigger,
    })
    m.start()
    m.tick(STAGE_TIMEOUT_MS) // → timeout
    expect(m.snapshot().phase).toBe("timeout")

    m.tryAgain()
    expect(m.snapshot().phase).toBe("waiting")
    expect(m.snapshot().elapsedMs).toBe(0)
    expect(retrigger).toHaveBeenCalledTimes(1) // underlying request re-triggered
  })
})

describe("timer pauses while approval has focus (WCAG 2.2.1 / AD-16 / Task 6)", () => {
  it("does NOT advance toward timeout while an approval surface holds focus", () => {
    const m = makeMachine()
    m.start()
    m.tick(SLOW_CONNECTION_HINT_MS) // slow-connection
    m.approvalFocused() // an approval surface takes focus — decision time is off the clock

    m.tick(STAGE_TIMEOUT_MS * 5) // would time out many times over if the clock ran
    expect(m.snapshot().phase).toBe("slow-connection") // frozen; NOT timeout

    m.approvalBlurred() // focus leaves → the network clock resumes
    m.tick(STAGE_TIMEOUT_MS)
    expect(m.snapshot().phase).toBe("timeout")
  })
})

describe("'I need more time' extension before an unavoidable timeout (Task 6)", () => {
  it("offers the extension before timeout and extends the stage when accepted", () => {
    const m = makeMachine()
    m.start()
    m.tick(SLOW_CONNECTION_HINT_MS)
    expect(m.snapshot().canExtend).toBe(true) // offered BEFORE the timeout fires

    m.extend() // "I need more time"
    m.tick(STAGE_TIMEOUT_MS - SLOW_CONNECTION_HINT_MS)
    // without the extension this would be 'timeout'; the extension pushed the bound out
    expect(m.snapshot().phase).not.toBe("timeout")
  })
})
