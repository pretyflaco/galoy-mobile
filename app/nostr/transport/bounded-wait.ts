/**
 * The single bounded-wait state machine (Story 3.1 / AD-11 / AD-16 / NFR-7 / WCAG 2.2.1).
 *
 * ONE pattern drives connect, session-establishment, and request handling identically:
 *
 *   waiting → slow-connection (BEFORE the stage timeout) → timeout → Try Again + context exit
 *
 * It inherits blink-terminal's timeout CONSTANTS (config.ts) and its no-infinite-spinner rule
 * but DROPS blink-terminal's staged ProgressStepper — simpler is the point (UX Flow 5). The RN
 * rne-theme component is a thin binding over this machine; all transition logic lives here so it
 * is unit-testable without React or real timers.
 *
 * AD-1: transport is UI-free. Elapsed time is advanced explicitly via `tick(ms)` (the RN binding
 * feeds it a real clock); no timers are held here.
 *
 * WCAG 2.2.1 (AD-16): while an approval surface holds focus the network clock is PAUSED — human
 * decision time is never on the clock. An "I need more time" extension is offered before an
 * unavoidable timeout and pushes the stage bound out when accepted.
 */

/** The context-appropriate exit offered at timeout (UX Flow 5). */
export type BoundedWaitExit = "cancel" | "sign-out"

export type BoundedWaitPhase = "idle" | "waiting" | "slow-connection" | "timeout"

export interface BoundedWaitSnapshot {
  phase: BoundedWaitPhase
  elapsedMs: number
  /** True once a terminal (timeout) is reached — the wait never dead-ends in a spinner. */
  isTerminal: boolean
  /** Try Again is offered at timeout (full stage reset + re-trigger). */
  canTryAgain: boolean
  /** "I need more time" is offered before an unavoidable timeout. */
  canExtend: boolean
  /** The exit affordance paired with Try Again at timeout. */
  exit: BoundedWaitExit
}

export interface BoundedWaitOptions {
  stageMs: number
  slowHintMs: number
  exit: BoundedWaitExit
  /** Invoked by tryAgain() to re-trigger the underlying request (Task 4). */
  onRetrigger?: () => void
}

export interface BoundedWait {
  start(): void
  /** Advance the network clock by `ms`. Ignored while paused by approval focus. */
  tick(ms: number): void
  /** An approval surface took focus — pause the clock (WCAG 2.2.1). */
  approvalFocused(): void
  /** Approval focus left — resume the clock. */
  approvalBlurred(): void
  /** Full stage reset + re-trigger the underlying request (Task 4). */
  tryAgain(): void
  /** "I need more time": extend the stage bound by one more stage window. */
  extend(): void
  snapshot(): BoundedWaitSnapshot
}

export const createBoundedWait = (options: BoundedWaitOptions): BoundedWait => {
  const { stageMs, slowHintMs, exit, onRetrigger } = options

  let phase: BoundedWaitPhase = "idle"
  let elapsedMs = 0
  let boundMs = stageMs
  let paused = false

  const recomputePhase = (): void => {
    if (phase === "idle") return
    if (elapsedMs >= boundMs) {
      phase = "timeout"
      return
    }
    phase = elapsedMs >= slowHintMs ? "slow-connection" : "waiting"
  }

  const reset = (): void => {
    elapsedMs = 0
    boundMs = stageMs
    paused = false
    phase = "waiting"
  }

  return {
    start(): void {
      reset()
    },
    tick(ms: number): void {
      // Paused (approval focused) or already terminal → the network clock does not advance.
      if (paused || phase === "timeout" || phase === "idle") return
      elapsedMs += ms
      recomputePhase()
    },
    approvalFocused(): void {
      paused = true
    },
    approvalBlurred(): void {
      paused = false
    },
    tryAgain(): void {
      reset()
      onRetrigger?.()
    },
    extend(): void {
      // Push the bound out by one more stage window (only meaningful before timeout).
      if (phase === "timeout") return
      boundMs += stageMs
      recomputePhase()
    },
    snapshot(): BoundedWaitSnapshot {
      const isTerminal = phase === "timeout"
      return {
        phase,
        elapsedMs,
        isTerminal,
        canTryAgain: isTerminal,
        // The extension is offered once the user can see waiting is degrading, up until timeout.
        canExtend: phase === "slow-connection" || phase === "waiting",
        exit,
      }
    },
  }
}
