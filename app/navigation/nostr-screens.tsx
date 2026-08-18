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

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native"
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
import {
  NostrActivityScreen,
  NostrActivityHeaderTitle,
} from "@app/screens/nostr/activity-screen"
import type { ActivityEntry, ActivityStats } from "@app/nostr/core/activity-log"
import { NostrIdentityHubScreen } from "@app/screens/nostr/identity-hub/nostr-identity-hub-screen"
import { useNostrIdentity } from "@app/screens/nostr/identity-hub/use-nostr-identity"
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
      name="nostrActivity"
      component={NostrActivity}
      options={{ title: LL.NostrActivityScreen.title() }}
    />
    {/* Approval surfaces (connection / request / review-all) are rendered by the
        ApprovalSurfaceHost as a state-driven full-screen overlay — NOT pushed routes — so a
        resolved approval never lingers underneath another screen. See approval-surface-host.tsx. */}
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
  const navigation = useNavigation<Nav>()
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

  const handleClientPress = useCallback(
    (clientPubkey: string) => navigation.navigate("nostrActivity", { clientPubkey }),
    [navigation],
  )

  return (
    <Screen preset="fixed">
      <NostrConnectedClientsSection
        clients={clients}
        onDisconnect={handleDisconnect}
        onClientPress={handleClientPress}
      />
    </Screen>
  )
}

/** Per-client activity history ("Show activity"), reading the metadata-only log from runtime. */
export const NostrActivity: React.FC = () => {
  const navigation = useNavigation<Nav>()
  const route = useRoute<RouteProp<RootStackParamList, "nostrActivity">>()
  const { clientPubkey } = route.params
  const runtime = useNostrRuntime()
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [stats, setStats] = useState<ActivityStats>({
    total: 0,
    accepted: 0,
    rejected: 0,
  })

  const reload = useCallback(async () => {
    const [e, s] = await Promise.all([
      runtime?.runtime.listActivity(clientPubkey) ?? Promise.resolve([]),
      runtime?.runtime.activityStats(clientPubkey) ??
        Promise.resolve({ total: 0, accepted: 0, rejected: 0 }),
    ])
    setEntries(e)
    setStats(s)
  }, [runtime, clientPubkey])

  // Live-refresh: the user lands here BEFORE the login flow finishes, so re-read on every new
  // activity entry (connect → read-public-key → signed event are recorded in sequence).
  useEffect(() => {
    reload().catch(() => undefined)
    const unsubscribe = runtime?.runtime.subscribeActivity(() => {
      reload().catch(() => undefined)
    })
    return unsubscribe
  }, [reload, runtime])

  // Custom header (Amber parity): client avatar + name. Fetch the connection record and install a
  // headerTitle component; falls back to the static title until the record resolves.
  useEffect(() => {
    let cancelled = false
    runtime?.runtime
      .listConnections()
      .then((records) => {
        if (cancelled) return
        const match = records.find((r) => r.clientPubkey === clientPubkey)
        if (!match?.metadata.name && !match?.metadata.image) return
        navigation.setOptions({
          headerTitle: () => (
            <NostrActivityHeaderTitle
              name={match?.metadata.name}
              image={match?.metadata.image}
            />
          ),
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [navigation, runtime, clientPubkey])

  return (
    <Screen preset="fixed">
      <NostrActivityScreen entries={entries} stats={stats} />
    </Screen>
  )
}
