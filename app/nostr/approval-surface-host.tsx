/**
 * ApprovalSurfaceHost — renders NIP-46 approvals as a full-screen overlay driven PURELY by the
 * ApprovalCoordinator's state (Amber's IncomingRequest model), NOT by pushing/popping navigation
 * routes.
 *
 * Why this shape (the fix for the stale-route + dead-reject bugs): the coordinator (Story 3.4) is
 * a UI-free FIFO exposing `activeEntry`/`pendingEntries` + `resolveActive`/`resolveMany`. This
 * host subscribes to it and, whenever an entry is active + presentable, renders the matching
 * surface inside a full-screen `<Modal>`. Approve/Reject call the coordinator only; clearing the
 * active entry (`active → null`) hides the Modal and the next queued surface (or nothing) renders.
 * There is no `navigate("approval")` / `goBack()` pair to desync — so Reject reliably dismisses,
 * and no stale approval route is ever left underneath another screen.
 *
 * The ONE deliberate navigation: after a CONNECTION approve, we navigate the app to the Connected
 * clients screen from the stable hub base, so its header back button returns to the Nostr Identity
 * hub (not to a resolved approval surface).
 *
 * Flag-gated implicitly: no runtime context / no active entry ⇒ the Modal is not shown (NFR-9).
 */
import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { Modal, View } from "react-native"

import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { makeStyles } from "@rn-vui/themed"

import { Screen } from "@app/components/screen"
import { RootStackParamList } from "@app/navigation/stack-param-lists"
import { NostrConnectionApprovalScreen } from "@app/screens/nostr/connection-approval-screen"
import { NostrDuplicateConnectionScreen } from "@app/screens/nostr/duplicate-connection-screen"
import { NostrRequestApprovalScreen } from "@app/screens/nostr/request-approval-screen"
import {
  NostrReviewAllScreen,
  type ReviewAllItem,
} from "@app/screens/nostr/review-all-screen"

import { NostrAwaitingFollowupScreen } from "@app/screens/nostr/awaiting-followup-screen"

import { REVIEW_ALL_THRESHOLD, type ApprovalEntry } from "./approval/coordinator"
import type { DuplicatePromptStore } from "./core/duplicate-prompt"
import type { AwaitingFollowupStore } from "./core/awaiting-followup"
import { useApprovalCoordinator } from "./hooks/use-approval-coordinator"
import { useNostrRuntime } from "./nostr-runtime-provider"

type Nav = NativeStackNavigationProp<RootStackParamList>

export const ApprovalSurfaceHost: React.FC = () => {
  const runtimeCtx = useNostrRuntime()
  if (!runtimeCtx) return null
  return (
    <>
      <ApprovalOverlay coordinator={runtimeCtx.coordinator} />
      <DuplicatePromptOverlay store={runtimeCtx.runtime.duplicatePrompt} />
      <AwaitingFollowupOverlay
        store={runtimeCtx.runtime.awaitingFollowup}
        coordinator={runtimeCtx.coordinator}
      />
    </>
  )
}

/**
 * Renders the sign-in "Waiting for login request…" surface as its OWN overlay, driven by the
 * runtime's awaiting-followup store. Shown only while NO approval is active (so the request
 * approval surface takes precedence the instant the login sign_event arrives) and the duplicate
 * prompt is not up. Cleared by the runtime on confirmed sign-in or timeout, which hides the Modal.
 */
const AwaitingFollowupOverlay: React.FC<{
  store: AwaitingFollowupStore
  coordinator: NonNullable<ReturnType<typeof useNostrRuntime>>["coordinator"]
}> = ({ store, coordinator }) => {
  const styles = useStyles()
  const runtime = useNostrRuntime()
  const awaiting = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.current(),
  )
  // Suppress while an approval is active — the approval Modal owns the screen then.
  const hasActiveApproval = useSyncExternalStore(
    (cb) => coordinator.subscribe(cb),
    () => coordinator.activeEntry() !== null,
  )
  const shouldShow = Boolean(awaiting) && !hasActiveApproval

  // Escape hatch: the same-device mobile flow can strand the user on this spinner (the
  // client app is backgrounded and never sends its sign-in challenge). Cancel — or the
  // Android back button via onRequestClose — clears the wait so the user is never trapped.
  const onCancel = useCallback(() => {
    const pubkey = awaiting?.clientPubkey
    if (pubkey) runtime?.runtime.cancelAwaitingFollowup(pubkey)
  }, [awaiting, runtime])

  return (
    <Modal
      visible={shouldShow}
      animationType="fade"
      transparent={false}
      onRequestClose={onCancel}
    >
      <Screen>
        <View style={styles.container}>
          {awaiting ? (
            <NostrAwaitingFollowupScreen
              clientName={awaiting.name}
              clientImage={awaiting.image}
              onCancel={onCancel}
            />
          ) : null}
        </View>
      </Screen>
    </Modal>
  )
}

/**
 * Renders the re-login Replace/Keep-both/Cancel prompt (fix #4) as its OWN overlay, driven by the
 * runtime's duplicate-prompt store (outside the binary approval coordinator). Resolving the
 * prompt clears the store's active entry, which hides the Modal.
 */
const DuplicatePromptOverlay: React.FC<{ store: DuplicatePromptStore }> = ({ store }) => {
  const styles = useStyles()
  const current = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.current(),
  )
  const req = current?.request
  return (
    <Modal
      visible={Boolean(current)}
      animationType="slide"
      transparent={false}
      onRequestClose={() => current?.resolve("cancel")}
    >
      <Screen>
        <View style={styles.container}>
          {req ? (
            <NostrDuplicateConnectionScreen
              clientName={req.metadata.name}
              clientImage={req.metadata.image}
              onReplace={() => current?.resolve("replace")}
              onKeepBoth={() => current?.resolve("keep")}
              onCancel={() => current?.resolve("cancel")}
            />
          ) : null}
        </View>
      </Screen>
    </Modal>
  )
}

/**
 * Resolve a connected client's friendly display (name + avatar) from the ConnectionStore by
 * pubkey, so the approval surfaces show "BTCPay Server" + logo rather than a raw hex pubkey.
 * Falls back to a truncated pubkey when the client is not (yet) a stored connection.
 */
const useClientDisplay = (clientPubkey?: string): { name?: string; image?: string } => {
  const runtime = useNostrRuntime()
  const listConnections = runtime?.runtime.listConnections
  const [display, setDisplay] = useState<{ name?: string; image?: string }>({})
  useEffect(() => {
    let cancelled = false
    if (!clientPubkey || !listConnections) {
      // Only clear if we actually hold a value (avoids a set-state-every-render loop).
      setDisplay((prev) =>
        prev.name === undefined && prev.image === undefined ? prev : {},
      )
      return
    }
    listConnections()
      .then((records) => {
        if (cancelled) return
        const match = records.find((r) => r.clientPubkey === clientPubkey)
        setDisplay((prev) => {
          const name = match?.metadata.name
          const image = match?.metadata.image
          return prev.name === name && prev.image === image ? prev : { name, image }
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // listConnections is a stable runtime method; depend only on the pubkey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientPubkey])
  return display
}

// Split so the hook is only used when a coordinator exists (hooks can't be conditional).
const ApprovalOverlay: React.FC<{
  coordinator: NonNullable<ReturnType<typeof useNostrRuntime>>["coordinator"]
}> = ({ coordinator }) => {
  const styles = useStyles()
  const navigation = useNavigation<Nav>()
  const { active, depth, visible, approve, reject } = useApprovalCoordinator(coordinator)

  // Is this active request part of a same-client BURST (>= threshold pending requests)? If so we
  // render the "Review all" surface instead of paging one-by-one (B5 / Flow 4).
  const sameClientRequests =
    active?.kind === "request"
      ? coordinator
          .pendingEntries()
          .filter((e) => e.kind === "request" && e.clientPubkey === active.clientPubkey)
          .length
      : 0
  const showReviewAll = sameClientRequests >= REVIEW_ALL_THRESHOLD

  const clientDisplay = useClientDisplay(active?.clientPubkey)
  const clientLabel =
    clientDisplay.name ??
    (active?.clientPubkey ? `${active.clientPubkey.slice(0, 12)}…` : "")

  // CONNECTION approve: resolve, then land on the client's Activity screen (Amber parity) from the
  // stable hub base so the back button returns to the Nostr Identity hub. The waiting overlay +
  // subsequent sign_event approval Modal float over Activity; when sign-in is delivered the user
  // rests on Activity showing the whole session (Connect / Read public key / Signed event).
  const onConnectionApprove = useCallback(() => {
    const clientPubkey = active?.clientPubkey
    approve()
    if (clientPubkey) navigation.navigate("nostrActivity", { clientPubkey })
  }, [active, approve, navigation])

  const onReviewApprove = useCallback(
    (ids: string[]) => coordinator.resolveMany(ids, true),
    [coordinator],
  )
  const onReviewReject = useCallback(
    (ids: string[]) => coordinator.resolveMany(ids, false),
    [coordinator],
  )

  const shouldShow = Boolean(active) && visible

  return (
    <Modal
      visible={shouldShow}
      animationType="slide"
      transparent={false}
      onRequestClose={reject}
    >
      <Screen>
        <View style={styles.container}>
          {active ? (
            <ActiveSurface
              active={active}
              coordinator={coordinator}
              showReviewAll={showReviewAll}
              clientLabel={clientLabel}
              clientImage={clientDisplay.image}
              depth={depth}
              onConnectionApprove={onConnectionApprove}
              onApprove={approve}
              onReject={reject}
              onReviewApprove={onReviewApprove}
              onReviewReject={onReviewReject}
            />
          ) : null}
        </View>
      </Screen>
    </Modal>
  )
}

/** Renders exactly one surface for the active entry (connection / request / review-all burst). */
const ActiveSurface: React.FC<{
  active: ApprovalEntry
  coordinator: NonNullable<ReturnType<typeof useNostrRuntime>>["coordinator"]
  showReviewAll: boolean
  clientLabel: string
  clientImage?: string
  depth: number
  onConnectionApprove: () => void
  onApprove: () => void
  onReject: () => void
  onReviewApprove: (ids: string[]) => void
  onReviewReject: (ids: string[]) => void
}> = ({
  active,
  coordinator,
  showReviewAll,
  clientLabel,
  clientImage,
  depth,
  onConnectionApprove,
  onApprove,
  onReject,
  onReviewApprove,
  onReviewReject,
}) => {
  if (active.kind === "connection") {
    return (
      <NostrConnectionApprovalScreen
        clientName={active.metadata.name}
        clientImage={active.metadata.image}
        onApprove={onConnectionApprove}
        onReject={onReject}
      />
    )
  }

  if (showReviewAll) {
    const requests = coordinator
      .pendingEntries()
      .filter((e) => e.kind === "request" && e.clientPubkey === active.clientPubkey)
    const items: ReviewAllItem[] = requests.map((r) => ({
      id: r.id,
      action: r.kind === "request" ? r.humanAction : "",
      preview: (r.kind === "request" && r.contentPreview) || "",
    }))
    return (
      <NostrReviewAllScreen
        clientName={clientLabel}
        items={items}
        onApproveSelected={onReviewApprove}
        onRejectSelected={onReviewReject}
      />
    )
  }

  return (
    <NostrRequestApprovalScreen
      clientName={clientLabel}
      clientImage={clientImage}
      humanAction={active.humanAction}
      contentPreview={active.contentPreview ?? ""}
      index={1}
      total={depth}
      onApprove={onApprove}
      onReject={onReject}
    />
  )
}

const useStyles = makeStyles(() => ({
  container: {
    flex: 1,
  },
}))
