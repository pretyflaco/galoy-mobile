/**
 * Story 3.4 — approval-surface presenter controller (Tasks 3/5/6, AD-9/AD-14).
 *
 * Framework-agnostic logic for the coordinator-driven surface: what to ANNOUNCE on appear
 * (requester + request + position), whether to PRESENT now vs HOLD (iOS foreground gate), and
 * the keep-app-open catch-up. Platform + focus land/trap/restore live in the RN hook; the
 * decisions live here so they are unit-testable without React/AppState.
 */
import {
  buildAnnouncement,
  shouldPresentNow,
  foregroundCatchUp,
  IOS_SCOPE_GUARD,
} from "../../app/nostr/approval/presenter"

describe("announcement (AC #4, a11y)", () => {
  it("announces requester + request + position (human terms, no raw scope/kind)", () => {
    const text = buildAnnouncement({
      index: 2,
      total: 32,
      client: "Damus",
      action: "decrypt a message",
    })
    expect(text).toContain("2")
    expect(text).toContain("32")
    expect(text).toContain("Damus")
    expect(text).toContain("decrypt a message")
    expect(text).not.toContain("nip44_decrypt")
    expect(text).not.toContain("22242")
  })
})

describe("iOS foreground gate (AC #5, AD-14)", () => {
  it("Android presents unconditionally (over any app state)", () => {
    expect(shouldPresentNow({ platform: "android", appState: "background" })).toBe(true)
    expect(shouldPresentNow({ platform: "android", appState: "active" })).toBe(true)
  })

  it("iOS presents only when active; holds while background/inactive", () => {
    expect(shouldPresentNow({ platform: "ios", appState: "active" })).toBe(true)
    expect(shouldPresentNow({ platform: "ios", appState: "background" })).toBe(false)
    expect(shouldPresentNow({ platform: "ios", appState: "inactive" })).toBe(false)
  })

  it("iOS foreground catch-up announces a waiting request (never silent) when depth > 0", () => {
    expect(foregroundCatchUp({ platform: "ios", queueDepth: 3 }).announce).toBe(true)
    expect(foregroundCatchUp({ platform: "ios", queueDepth: 0 }).announce).toBe(false)
    // Android never needs the catch-up (presents over any state)
    expect(foregroundCatchUp({ platform: "android", queueDepth: 3 }).announce).toBe(false)
  })

  it("encodes the v1 scope guard: NO background mode, NO NSE, NO watcher", () => {
    expect(IOS_SCOPE_GUARD).toEqual({
      backgroundMode: false,
      nseSigning: false,
      watcherRegistration: false,
    })
  })
})
