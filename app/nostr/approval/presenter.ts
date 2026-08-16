/**
 * Approval-surface presenter decisions (Story 3.4 / Tasks 3/5/6 / AD-9 / AD-14).
 *
 * Framework-agnostic decisions for the coordinator-driven surface: the announcement string
 * (requester + request + position, human terms only), whether to present now vs hold (iOS
 * foreground gate), and the iOS keep-app-open catch-up. The RN hook binds these to
 * `AccessibilityInfo`, focus management, and `AppState`; keeping the decisions here makes them
 * unit-testable without React.
 *
 * AD-14 v1 amendment (iOS foreground-only): the scope guard below encodes that v1 registers NO
 * background mode, NO NSE signing path, and NO watcher — an explicit anti-scope-creep marker.
 * AD-1: this module is UI-free.
 */

export type Platform = "ios" | "android"
export type AppStateValue = "active" | "background" | "inactive"

/** The v1 iOS scope guard (AD-14): foreground-only, nothing deferred creeps back in. */
export const IOS_SCOPE_GUARD = {
  backgroundMode: false,
  nseSigning: false,
  watcherRegistration: false,
} as const

export interface AnnouncementParams {
  index: number
  total: number
  client: string
  /** Human-meaning action (e.g. "decrypt a message") — NEVER raw scope/kind. */
  action: string
}

/**
 * Build the assertive announcement for a surface on appear, e.g.
 * "Request 2 of 32 from Damus, wants to decrypt a message." Human terms only.
 */
export const buildAnnouncement = (params: AnnouncementParams): string => {
  const { index, total, client, action } = params
  return `Request ${index} of ${total} from ${client}, wants to ${action}`
}

export interface PresentGateInput {
  platform: Platform
  appState: AppStateValue
}

/**
 * Whether a surface may be PRESENTED now. Android renders over ANY app state (full Amber
 * parity). iOS is foreground-only: a request arriving while background/inactive is HELD and
 * presented on the next active transition (AD-14 v1 amendment).
 */
export const shouldPresentNow = (input: PresentGateInput): boolean => {
  if (input.platform === "android") return true
  return input.appState === "active"
}

export interface CatchUpInput {
  platform: Platform
  queueDepth: number
}

/**
 * On an iOS foreground transition with a non-empty queue, the keep-app-open catch-up must be
 * ANNOUNCED assertively (not merely rendered) so AT users are not left in a silent black hole.
 * Android never needs it (presents over any state).
 */
export const foregroundCatchUp = (input: CatchUpInput): { announce: boolean } => {
  return { announce: input.platform === "ios" && input.queueDepth > 0 }
}
