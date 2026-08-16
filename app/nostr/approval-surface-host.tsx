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
  const presentedRef = useRef<null | "connection" | "request">(null)

  useEffect(() => {
    const shouldShow = Boolean(active) && visible

    if (shouldShow && active && presentedRef.current === null) {
      presentedRef.current = active.kind
      navigation.navigate(
        active.kind === "connection" ? "nostrConnectionApproval" : "nostrRequestApproval",
      )
      return
    }

    // Entry resolved (or hidden) while a route is up → pop it.
    if (!shouldShow && presentedRef.current !== null) {
      presentedRef.current = null
      if (navigation.canGoBack()) navigation.goBack()
    }
  }, [active, visible, navigation])

  return null
}
