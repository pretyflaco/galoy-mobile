/**
 * ApprovalSurfaceHost (Story A6 / fix #1) — presents approvals as FULL SCREENS, not overlays.
 *
 * The ApprovalCoordinator (Story 3.4) owns approval sequencing but is UI-free: it exposes an
 * `activeEntry` and resolves via `resolveActive`. This host is a HEADLESS component (renders no
 * UI itself): mounted once under NostrRuntimeProvider, it watches the coordinator and, when an
 * entry becomes active + presentable, NAVIGATES to the corresponding full-screen approval route
 * (nostrConnectionApproval / nostrRequestApproval). When the entry resolves (active → null) it
 * pops the route. This replaces the earlier modal overlay, which floated over the live camera.
 *
 * The approval ROUTES (app/navigation/nostr-screens.tsx) render the actual approval content and
 * drive approve/reject through the same coordinator. Flag-gated implicitly: no runtime context /
 * no entries ⇒ this navigates nowhere (NFR-9 — never intrudes on the wallet).
 */
import React, { useEffect, useRef } from "react"

import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { RootStackParamList } from "@app/navigation/stack-param-lists"

import { REVIEW_ALL_THRESHOLD } from "./approval/coordinator"
import { useApprovalCoordinator } from "./hooks/use-approval-coordinator"
import { useNostrRuntime } from "./nostr-runtime-provider"

export const ApprovalSurfaceHost: React.FC = () => {
  const runtimeCtx = useNostrRuntime()
  if (!runtimeCtx) return null
  return <ApprovalNavigator coordinator={runtimeCtx.coordinator} />
}

// Split so the hook is only used when a coordinator exists (hooks can't be conditional).
const ApprovalNavigator: React.FC<{
  coordinator: NonNullable<ReturnType<typeof useNostrRuntime>>["coordinator"]
}> = ({ coordinator }) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { active, visible } = useApprovalCoordinator(coordinator)
  // Track whether WE pushed an approval route, so we only pop what we pushed.
  const presentedRef = useRef<null | "connection" | "request" | "reviewAll">(null)

  useEffect(() => {
    const shouldShow = Boolean(active) && visible

    if (shouldShow && active && presentedRef.current === null) {
      if (active.kind === "connection") {
        presentedRef.current = "connection"
        navigation.navigate("nostrConnectionApproval")
        return
      }
      // Request: if this client has a BURST of queued requests, present the "Review all"
      // surface (B5) instead of paging one-by-one; otherwise the single request surface.
      const sameClientRequests = coordinator
        .pendingEntries()
        .filter(
          (e) => e.kind === "request" && e.clientPubkey === active.clientPubkey,
        ).length
      if (sameClientRequests >= REVIEW_ALL_THRESHOLD) {
        presentedRef.current = "reviewAll"
        navigation.navigate("nostrReviewAll")
      } else {
        presentedRef.current = "request"
        navigation.navigate("nostrRequestApproval")
      }
      return
    }

    // Entry resolved (or hidden) while a route is up → pop it. EXCEPTION: connection approvals
    // self-navigate on approve (the route sends the user to Connected clients), so the host must
    // NOT also pop — that would double-navigate. The review-all route pops itself when the burst
    // drains. Only auto-pop the single request approval, which has no natural landing screen.
    if (!shouldShow && presentedRef.current !== null) {
      const wasSingleRequest = presentedRef.current === "request"
      presentedRef.current = null
      if (wasSingleRequest && navigation.canGoBack()) navigation.goBack()
    }
  }, [active, visible, navigation, coordinator])

  return null
}
