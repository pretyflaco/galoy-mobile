/**
 * Nostr signer navigation wrappers (Story A2).
 *
 * The signer screens are navigation-agnostic (callback props, AD-1). These thin wrappers bind
 * them to React Navigation + the signer runtime so they can be registered as root-stack screens.
 * All of these are only reachable from the Nostr Identity settings row, which is itself gated by
 * the nostrSignerEnabled flag (AD-13); a defensive flag check here keeps them inert if reached
 * with the flag off.
 */
import React, { useCallback, useEffect, useState } from "react"

import { useNavigation } from "@react-navigation/native"
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from "@react-navigation/native-stack"

import type { TranslationFunctions } from "@app/i18n/i18n-types"

import { CreateIdentityNavigator } from "@app/screens/nostr/create-identity/create-identity-navigator"
import { NostrImportIdentityScreen } from "@app/screens/nostr/import-identity/import-identity-screen"
import { NostrBackupScreen } from "@app/screens/nostr/backup/nostr-backup-screen"
import {
  NostrConnectedClientsSection,
  type ConnectedClient,
} from "@app/screens/nostr/connected-clients-section"
import { NostrConnectionApprovalScreen } from "@app/screens/nostr/connection-approval-screen"
import { NostrRequestApprovalScreen } from "@app/screens/nostr/request-approval-screen"
import {
  NostrReviewAllScreen,
  type ReviewAllItem,
} from "@app/screens/nostr/review-all-screen"
import { NostrIdentityHubScreen } from "@app/screens/nostr/identity-hub/nostr-identity-hub-screen"
import { useNostrIdentity } from "@app/screens/nostr/identity-hub/use-nostr-identity"
import { useApprovalCoordinator } from "@app/nostr/hooks/use-approval-coordinator"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"
import { Screen } from "@app/components/screen"

import { RootStackParamList } from "./stack-param-lists"

type Nav = NativeStackNavigationProp<RootStackParamList>

/**
 * All signer root-stack screens as a single fragment, so the root navigator registers them with
 * one call (keeps root-navigator.tsx under its per-function line budget). React Navigation
 * accepts a fragment of Screen elements as Navigator children.
 */
export const NostrRootScreens = (
  RootNavigator: ReturnType<typeof createNativeStackNavigator<RootStackParamList>>,
  LL: TranslationFunctions,
): React.ReactElement => (
  <>
    <RootNavigator.Screen
      name="nostrIdentity"
      component={NostrIdentityHub}
      options={{ title: LL.NostrIdentityScreen.title() }}
    />
    <RootNavigator.Screen
      name="nostrCreateIdentity"
      component={NostrCreateIdentity}
      options={{ title: LL.NostrCreateIdentityScreen.introTitle() }}
    />
    <RootNavigator.Screen
      name="nostrImportIdentity"
      component={NostrImportIdentity}
      options={{ title: LL.NostrImportIdentityScreen.title() }}
    />
    <RootNavigator.Screen
      name="nostrBackup"
      component={NostrBackup}
      options={{ title: LL.NostrBackupScreen.title() }}
    />
    <RootNavigator.Screen
      name="nostrConnectedClients"
      component={NostrConnectedClients}
      options={{ title: LL.NostrConnectedClientsScreen.sectionTitle() }}
    />
    <RootNavigator.Screen
      name="nostrConnectionApproval"
      component={NostrConnectionApproval}
      options={{ title: LL.NostrConnectionApprovalScreen.title(), headerShown: false }}
    />
    <RootNavigator.Screen
      name="nostrRequestApproval"
      component={NostrRequestApproval}
      options={{ title: LL.NostrRequestApprovalScreen.title(), headerShown: false }}
    />
    <RootNavigator.Screen
      name="nostrReviewAll"
      component={NostrReviewAll}
      options={{ title: LL.NostrReviewAllScreen.title(), headerShown: false }}
    />
  </>
)

/** The Nostr Identity hub — empty-state (create/import) vs. summary (manage). */
export const NostrIdentityHub: React.FC = () => {
  const navigation = useNavigation<Nav>()
  const { loading, npub, reload } = useNostrIdentity()

  // Refresh on focus so a completed create/import/replace reflects immediately.
  useEffect(() => navigation.addListener("focus", reload), [navigation, reload])

  return (
    <Screen>
      <NostrIdentityHubScreen
        loading={loading}
        npub={npub}
        onCreate={() => navigation.navigate("nostrCreateIdentity")}
        onImport={() => navigation.navigate("nostrImportIdentity")}
        onBackup={() => navigation.navigate("nostrBackup")}
        onReplace={() => navigation.navigate("nostrImportIdentity")}
        onConnectedClients={() => navigation.navigate("nostrConnectedClients")}
        onScanToConnect={() => navigation.navigate("scanningQRCode")}
      />
    </Screen>
  )
}

/** The three-step creation ceremony, wired to exit back to the hub. */
export const NostrCreateIdentity: React.FC = () => {
  const navigation = useNavigation<Nav>()
  return (
    <Screen>
      <CreateIdentityNavigator
        onImport={() => navigation.navigate("nostrImportIdentity")}
        onBackup={() => navigation.navigate("nostrBackup")}
        onExit={() => navigation.goBack()}
      />
    </Screen>
  )
}

/** nsec import / replace, wired to the existing QR scanner + exit back to the hub. */
export const NostrImportIdentity: React.FC = () => {
  const navigation = useNavigation<Nav>()
  return (
    <Screen>
      <NostrImportIdentityScreen
        onScan={() => navigation.navigate("scanningQRCode")}
        onDone={() => navigation.goBack()}
        onCancel={() => navigation.goBack()}
      />
    </Screen>
  )
}

/** nsec backup entry, wired to exit back to the hub. */
export const NostrBackup: React.FC = () => {
  const navigation = useNavigation<Nav>()
  return (
    <Screen>
      <NostrBackupScreen
        onEncryptedBackup={() => navigation.goBack()}
        onPlaintextAcknowledged={() => navigation.goBack()}
        onNotNow={() => navigation.goBack()}
      />
    </Screen>
  )
}

/** Connected clients list-and-revoke, reading from the runtime's ConnectionStore. */
export const NostrConnectedClients: React.FC = () => {
  const runtime = useNostrRuntime()
  const [clients, setClients] = useState<ConnectedClient[]>([])

  const reload = useCallback(async () => {
    const records = (await runtime?.runtime.listConnections()) ?? []
    setClients(
      records.map((r) => ({
        clientPubkey: r.clientPubkey,
        name: r.metadata.name ?? r.clientPubkey.slice(0, 12),
        relays: r.relays,
        image: r.metadata.image,
        createdAt: r.createdAt,
      })),
    )
  }, [runtime])

  useEffect(() => {
    reload().catch(() => undefined)
  }, [reload])

  const handleDisconnect = useCallback(
    (clientPubkey: string) => {
      // Actually disconnect (atomic delete + void grant + tombstone), THEN refresh the list.
      runtime?.runtime
        .disconnect(clientPubkey)
        .then(() => reload())
        .catch(() => undefined)
    },
    [runtime, reload],
  )

  return (
    <Screen>
      <NostrConnectedClientsSection clients={clients} onDisconnect={handleDisconnect} />
    </Screen>
  )
}

/**
 * Full-screen CONNECTION approval route (Story A6 / fix #1). Presented by the ApprovalSurfaceHost
 * when the coordinator's active entry is a connection; renders the approval content full-bleed (a
 * proper screen, not a camera overlay). Approve/Reject resolve the coordinator, which unmounts
 * the route (the host pops it when active clears).
 */
export const NostrConnectionApproval: React.FC = () => {
  const navigation = useNavigation<Nav>()
  const runtime = useNostrRuntime()
  const coordinator = runtime?.coordinator
  const { active, approve, reject } = useApprovalCoordinator(coordinator ?? ({} as never))
  const clientName = active?.kind === "connection" ? active.metadata.name : undefined
  const clientImage = active?.kind === "connection" ? active.metadata.image : undefined

  // On approve, resolve the coordinator (the host pops this route) and land the user on the
  // Connected clients screen so they see the app they just connected — rather than popping back
  // to wherever the scan was launched from (e.g. Home).
  const onApprove = useCallback(() => {
    approve()
    navigation.navigate("nostrConnectedClients")
  }, [approve, navigation])

  return (
    <Screen>
      <NostrConnectionApprovalScreen
        clientName={clientName}
        clientImage={clientImage}
        onApprove={onApprove}
        onReject={reject}
      />
    </Screen>
  )
}

/**
 * Resolve a connected client's friendly display (name + avatar) from the ConnectionStore by
 * pubkey, so the approval surfaces show "BTCPay Server" + logo rather than a raw hex pubkey.
 * Falls back to a truncated pubkey when the client is not (yet) a stored connection.
 */
const useClientDisplay = (clientPubkey?: string): { name?: string; image?: string } => {
  const runtime = useNostrRuntime()
  const [display, setDisplay] = useState<{ name?: string; image?: string }>({})
  useEffect(() => {
    let cancelled = false
    if (!clientPubkey) {
      setDisplay({})
      return
    }
    runtime?.runtime
      .listConnections()
      .then((records) => {
        if (cancelled) return
        const match = records.find((r) => r.clientPubkey === clientPubkey)
        setDisplay({ name: match?.metadata.name, image: match?.metadata.image })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [runtime, clientPubkey])
  return display
}

/** Full-screen REQUEST approval route (sign/decrypt) — same pattern as the connection route. */
export const NostrRequestApproval: React.FC = () => {
  const runtime = useNostrRuntime()
  const coordinator = runtime?.coordinator
  const { active, depth, approve, reject } = useApprovalCoordinator(
    coordinator ?? ({} as never),
  )
  const req = active?.kind === "request" ? active : null
  const display = useClientDisplay(req?.clientPubkey)
  const clientLabel =
    display.name ?? (req?.clientPubkey ? `${req.clientPubkey.slice(0, 12)}…` : "")
  // Real queue position: the active entry is always first in pendingEntries() (B5 API).
  const index = 1
  return (
    <Screen>
      <NostrRequestApprovalScreen
        clientName={clientLabel}
        clientImage={display.image}
        humanAction={req?.humanAction ?? ""}
        contentPreview={req?.contentPreview ?? ""}
        index={index}
        total={depth}
        onApprove={approve}
        onReject={reject}
      />
    </Screen>
  )
}

/**
 * Full-screen "Review all" burst route (B5 / Flow 4). Presented by the ApprovalSurfaceHost when
 * a client has REVIEW_ALL_THRESHOLD+ pending REQUEST approvals queued. Expands the serialized
 * queue into a selectable list and batch-resolves the chosen requests via the coordinator's
 * resolveMany (no "approve all remaining"). When the queue drains below 2, the host pops back to
 * one-by-one paging.
 */
export const NostrReviewAll: React.FC = () => {
  const navigation = useNavigation<Nav>()
  const runtime = useNostrRuntime()
  const coordinator = runtime?.coordinator
  // Subscribe for re-render on queue changes; read the full pending snapshot from the coordinator.
  const { depth } = useApprovalCoordinator(coordinator ?? ({} as never))
  const pending = coordinator?.pendingEntries() ?? []
  const requests = pending.filter((e) => e.kind === "request")
  const clientPubkey = requests[0]?.clientPubkey
  const display = useClientDisplay(clientPubkey)
  const clientLabel =
    display.name ?? (clientPubkey ? `${clientPubkey.slice(0, 12)}…` : "")

  const items: ReviewAllItem[] = requests.map((r) => ({
    id: r.id,
    action: r.kind === "request" ? r.humanAction : "",
    preview: (r.kind === "request" && r.contentPreview) || "",
  }))

  const onApproveSelected = useCallback(
    (ids: string[]) => coordinator?.resolveMany(ids, true),
    [coordinator],
  )
  const onRejectSelected = useCallback(
    (ids: string[]) => coordinator?.resolveMany(ids, false),
    [coordinator],
  )

  // When the burst has drained (depth < 2), leave the review-all surface (the host resumes
  // one-by-one paging for any remainder).
  useEffect(() => {
    if (depth < 2 && navigation.canGoBack()) navigation.goBack()
  }, [depth, navigation])

  return (
    <Screen>
      <NostrReviewAllScreen
        clientName={clientLabel}
        items={items}
        onApproveSelected={onApproveSelected}
        onRejectSelected={onRejectSelected}
      />
    </Screen>
  )
}
