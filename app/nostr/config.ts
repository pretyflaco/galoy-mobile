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
