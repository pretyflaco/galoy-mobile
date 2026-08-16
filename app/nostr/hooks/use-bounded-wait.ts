import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { STAGE_TIMEOUT_MS, SLOW_CONNECTION_HINT_MS } from "@app/nostr/config"
import {
  createBoundedWait,
  type BoundedWaitExit,
  type BoundedWaitSnapshot,
} from "@app/nostr/transport/bounded-wait"

/** How often the hook advances the machine's network clock while a stage is active. */
const TICK_INTERVAL_MS = 250

type UseBoundedWaitArgs = {
  /** Whether a network stage is currently in-flight (drives start/stop of the clock). */
  active: boolean
  /** The context-appropriate exit at timeout (Cancel for general, Sign Out for a session). */
  exit: BoundedWaitExit
  /** Re-trigger the underlying request on Try Again (Task 4). */
  onRetrigger: () => void
  /** True while an approval surface holds focus — pauses the clock (WCAG 2.2.1). */
  approvalFocused?: boolean
}

/**
 * React binding for the single bounded-wait machine (Story 3.1). Shared by connect,
 * session-establishment, and request handling so all three get identical waiting → slow →
 * timeout behavior, Try Again reset, the "I need more time" extension, and the WCAG 2.2.1
 * pause while an approval surface holds focus. All transition logic lives in the
 * framework-agnostic `createBoundedWait` machine; this hook only feeds it a real clock.
 */
export const useBoundedWait = ({
  active,
  exit,
  onRetrigger,
  approvalFocused = false,
}: UseBoundedWaitArgs) => {
  const machine = useMemo(
    () =>
      createBoundedWait({
        stageMs: STAGE_TIMEOUT_MS,
        slowHintMs: SLOW_CONNECTION_HINT_MS,
        exit,
        onRetrigger,
      }),
    [exit, onRetrigger],
  )

  const [snapshot, setSnapshot] = useState<BoundedWaitSnapshot>(machine.snapshot())
  const lastTsRef = useRef<number | null>(null)

  // Start / stop the stage with the active flag.
  useEffect(() => {
    if (!active) return
    machine.start()
    setSnapshot(machine.snapshot())
    lastTsRef.current = Date.now()
  }, [active, machine])

  // Pause / resume the network clock on approval focus (decision time is off the clock).
  useEffect(() => {
    if (approvalFocused) machine.approvalFocused()
    else machine.approvalBlurred()
  }, [approvalFocused, machine])

  // Drive the machine's clock while active and not terminal.
  useEffect(() => {
    if (!active) return undefined
    const id = setInterval(() => {
      const now = Date.now()
      const last = lastTsRef.current ?? now
      lastTsRef.current = now
      machine.tick(now - last)
      setSnapshot(machine.snapshot())
    }, TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [active, machine])

  const tryAgain = useCallback(() => {
    machine.tryAgain()
    lastTsRef.current = Date.now()
    setSnapshot(machine.snapshot())
  }, [machine])

  const extend = useCallback(() => {
    machine.extend()
    setSnapshot(machine.snapshot())
  }, [machine])

  return { snapshot, tryAgain, extend }
}
