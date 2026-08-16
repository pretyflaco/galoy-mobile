/**
 * ApprovalSurfaceHost (Story A6 / AD-9) — the RN presenter that was the missing keystone.
 *
 * The ApprovalCoordinator (Story 3.4) OWNS approval sequencing but is UI-free: it exposes an
 * `activeEntry` and resolves via `resolveActive`. Something must actually RENDER that active
 * entry as a surface and feed the human's decision back. Without this host, a scanned
 * nostrconnect:// connection (or an inbound sign/decrypt request) enqueues, the coordinator's
 * no-op `present` runs, and nothing ever appears — the flow silently dead-ends. This component
 * closes that gap.
 *
 * Mounted ONCE, high in the tree (app.tsx, under NostrRuntimeProvider), it:
 *  - subscribes to the SAME coordinator singleton the runtime enqueues into (via the runtime
 *    context) through the existing useApprovalCoordinator hook (announce + focus land/trap);
 *  - renders the connection-approval surface for a `connection` entry and the request-approval
 *    surface for a `request` entry, as a modal overlay above the current screen;
 *  - wires Approve/Reject to coordinator.resolveActive.
 *
 * Flag-gated implicitly: the runtime context is null / no entries when the signer is disabled,
 * so the host renders nothing (NFR-9 — never intrudes on the wallet).
 */
import React from "react"
import ReactNativeModal from "react-native-modal"

import { useApprovalCoordinator } from "./hooks/use-approval-coordinator"
import { useNostrRuntime } from "./nostr-runtime-provider"
import { NostrConnectionApprovalScreen } from "@app/screens/nostr/connection-approval-screen"
import { NostrRequestApprovalScreen } from "@app/screens/nostr/request-approval-screen"

export const ApprovalSurfaceHost: React.FC = () => {
  const runtimeCtx = useNostrRuntime()
  if (!runtimeCtx) return null
  return <ApprovalSurface coordinator={runtimeCtx.coordinator} />
}

// Split so the hook is only used when a coordinator exists (hooks can't be conditional).
const ApprovalSurface: React.FC<{
  coordinator: NonNullable<ReturnType<typeof useNostrRuntime>>["coordinator"]
}> = ({ coordinator }) => {
  const { active, visible, depth, approve, reject } = useApprovalCoordinator(coordinator)

  const isOpen = Boolean(active) && visible

  return (
    <ReactNativeModal
      isVisible={isOpen}
      onBackdropPress={reject}
      // Reject on hardware back / swipe-dismiss — never silently approve.
      onBackButtonPress={reject}
      backdropOpacity={0.6}
    >
      {active?.kind === "connection" && (
        <NostrConnectionApprovalScreen
          clientName={active.metadata.name}
          onApprove={approve}
          onReject={reject}
        />
      )}
      {active?.kind === "request" && (
        <NostrRequestApprovalScreen
          clientName={active.clientPubkey}
          humanAction={active.humanAction}
          contentPreview={active.contentPreview ?? ""}
          index={1}
          total={depth}
          onApprove={approve}
          onReject={reject}
        />
      )}
    </ReactNativeModal>
  )
}
