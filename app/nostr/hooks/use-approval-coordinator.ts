import { useCallback, useEffect, useRef, useState } from "react"
import { AccessibilityInfo, AppState, Platform, findNodeHandle } from "react-native"

import type { ApprovalCoordinator, ApprovalEntry } from "@app/nostr/approval/coordinator"
import {
  buildAnnouncement,
  foregroundCatchUp,
  shouldPresentNow,
  type AppStateValue,
  type Platform as SignerPlatform,
} from "@app/nostr/approval/presenter"

const platform = (): SignerPlatform => (Platform.OS === "ios" ? "ios" : "android")

/**
 * Coordinator-driven React binding (Story 3.4 / Tasks 3/5/6). Subscribes to the single
 * ApprovalCoordinator and exposes the active entry + queue depth to the surface. On each new
 * surface it:
 *  - ANNOUNCES requester + request + position assertively (AccessibilityInfo);
 *  - lands focus on the requester/request heading (setAccessibilityFocus on the ref), trapped
 *    for the surface's duration and restored to the next queued surface on drain;
 *  - (iOS) HOLDS presentation while backgrounded/inactive and drains + announces the
 *    keep-app-open catch-up on the next foreground (AppState). Android presents unconditionally.
 *
 * No background mode / NSE / watcher is registered (AD-14 v1 scope guard) — foreground drain is
 * driven purely by AppState.
 */
export const useApprovalCoordinator = (coordinator: ApprovalCoordinator) => {
  const [active, setActive] = useState<ApprovalEntry | null>(coordinator.activeEntry())
  const [depth, setDepth] = useState<number>(coordinator.queueDepth())
  const [appState, setAppState] = useState<AppStateValue>(
    (AppState.currentState as AppStateValue) ?? "active",
  )
  // True when an iOS foreground transition finds a waiting queue — the screen renders the
  // keep-app-open catch-up (i18n copy) in an assertive live region so it is announced.
  const [catchUpPending, setCatchUpPending] = useState(false)
  const focusRef = useRef<unknown>(null)
  const lastAnnouncedId = useRef<string | null>(null)

  // Subscribe to coordinator changes.
  useEffect(() => {
    const sync = () => {
      setActive(coordinator.activeEntry())
      setDepth(coordinator.queueDepth())
    }
    sync()
    return coordinator.subscribe(sync)
  }, [coordinator])

  // Track AppState for the iOS foreground gate + catch-up.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppState(next as AppStateValue)
      const catchUp = foregroundCatchUp({
        platform: platform(),
        queueDepth: coordinator.queueDepth(),
      })
      setCatchUpPending(next === "active" && catchUp.announce)
    })
    return () => sub.remove()
  }, [coordinator])

  // Whether the active surface may be shown now (iOS foreground gate; Android unconditional).
  const visible = active !== null && shouldPresentNow({ platform: platform(), appState })

  // On a NEW visible surface: announce assertively + land focus on the heading.
  useEffect(() => {
    if (!visible || !active) return
    if (lastAnnouncedId.current === active.id) return
    lastAnnouncedId.current = active.id

    if (active.kind === "request") {
      AccessibilityInfo.announceForAccessibility(
        buildAnnouncement({
          index: 1,
          total: coordinator.queueDepth(),
          client: active.clientPubkey,
          action: active.humanAction,
        }),
      )
    }

    const node = focusRef.current ? findNodeHandle(focusRef.current as never) : null
    if (node) AccessibilityInfo.setAccessibilityFocus(node)
  }, [visible, active, coordinator])

  const approve = useCallback(() => {
    coordinator.resolveActive({ approved: true })
  }, [coordinator])

  const reject = useCallback(() => {
    coordinator.resolveActive({ approved: false })
  }, [coordinator])

  return { active, depth, visible, approve, reject, focusRef, catchUpPending }
}
