/**
 * Signer configuration (AD-11 / AD-13): timeouts, relay defaults, and the single owner
 * of the feature-flag KEY string. Timeouts/relay defaults land with Epic 3; this story
 * establishes the feature-flag key.
 *
 * `SignerEnabledKey` is the ONE owner of the remote-flag key string; the app's remote
 * feature-flag substrate (app/config/feature-flags-context.tsx) references this constant
 * so there is no drift. Default is OFF (see defaultRemoteConfig).
 */
export const SignerEnabledKey = "nostrSignerEnabled" as const

/**
 * Bounded-wait timeout constants (AD-11): every network-dependent stage is bounded so
 * the UI never shows an infinite spinner. A slow-connection hint precedes the stage
 * timeout; on timeout the UI offers Try Again + Cancel. Mirrors blink-terminal.
 */
export const STAGE_TIMEOUT_MS = 10_000 // per-stage bound (~10s)
export const OUTER_CONNECT_TIMEOUT_MS = 30_000 // outer connect bound (~30s)
export const SLOW_CONNECTION_HINT_MS = 5_000 // show "still working…" before the stage timeout

/** Ceremony budget (NFR-2 / SPEC CAP-1): start-to-completion under 30s on reference devices. */
export const CEREMONY_BUDGET_MS = 30_000

/**
 * The single wrapper for EVERY network-dependent await on the signer path (AD-11 / NFR-7).
 *
 * Bounds `fn` by `ms` (read from the constants above — no inline literal timeouts on any
 * network stage) and by an optional injected `AbortSignal`. On expiry it rejects with a
 * typed `SignerError` ({ code: "timeout" }); on abort it rejects with { code: "aborted" }.
 * There is deliberately no un-timed path: a bare unbounded await is never allowed to hang
 * the UI (no infinite spinner is representable).
 *
 * AD-1: config carries no React/UI. The rejection is a real `Error` carrying the typed
 * `code` discriminant, so it satisfies both the SignerError shape (core/signer.ts checks
 * `code` + `message`) and prefer-promise-reject-errors. The shape is reconstructed here (not
 * imported) so config stays a leaf with no core dependency.
 */
class BoundedStageError extends Error {
  constructor(
    readonly code: "timeout" | "aborted",
    message: string,
  ) {
    super(message)
    this.name = "BoundedStageError"
  }
}

export const withBoundedStage = <T>(
  ms: number,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (cb: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener("abort", onAbort)
      cb()
    }
    const onAbort = (): void =>
      finish(() => reject(new BoundedStageError("aborted", "network stage aborted")))
    const timer = setTimeout(
      () =>
        finish(() => reject(new BoundedStageError("timeout", "network stage timed out"))),
      ms,
    )
    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener("abort", onAbort)
    }
    fn().then(
      (value) => finish(() => resolve(value)),
      (cause) => finish(() => reject(cause)),
    )
  })
}
