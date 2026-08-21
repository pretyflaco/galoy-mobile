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
import { Linking } from "react-native"

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native"
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from "@react-navigation/native-stack"

import { useAppConfig } from "@app/hooks"
import { useI18nContext } from "@app/i18n/i18n-react"
import type { TranslationFunctions } from "@app/i18n/i18n-types"
import { loadString, saveString } from "@app/utils/storage/storage"
import { toastShow } from "@app/utils/toast"

import { useNostrProfilePicture } from "@app/nostr/use-nostr-profile-picture"
import {
  BtcpaySetupScreen,
  type BtcpaySetupPhase,
  type BtcpaySetupVariant,
} from "@app/screens/nostr/btcpay-setup/btcpay-setup-screen"
import { CreateIdentityNavigator } from "@app/screens/nostr/create-identity/create-identity-navigator"
import { useProfilePictureUpload } from "@app/screens/nostr/identity-hub/use-profile-picture-upload"
import { NostrImportIdentityScreen } from "@app/screens/nostr/import-identity/import-identity-screen"
import { NostrBackupNavigator } from "@app/screens/nostr/backup/nostr-backup-navigator"
import { nostrBackupDoneKey } from "@app/screens/nostr/backup/use-nostr-backup"
import { NostrSettingsScreen } from "@app/screens/nostr/settings/nostr-settings-screen"
import { NostrReplaceChoiceScreen } from "@app/screens/nostr/settings/replace-choice-screen"
import {
  NostrConnectedClientsSection,
  type ConnectedClient,
} from "@app/screens/nostr/connected-clients-section"
import {
  NostrActivityScreen,
  NostrActivityHeaderTitle,
} from "@app/screens/nostr/activity-screen"
import type { ActivityEntry, ActivityStats } from "@app/nostr/core/activity-log"
import { normalizeHost } from "@app/nostr/core/url-origin"
import {
  btcpayNip98LoginUrl,
  buildBtcpayLoginUrl,
  BTCPAY_INSTANCE_URL,
  BTCPAY_INSTANCE_IMAGE,
} from "@app/nostr/core/btcpay-login-link"
import { normalizeLightningAddress } from "@app/nostr/core/lightning-address"
import { NIP98_KIND } from "@app/nostr/core/policy-check"
import { NostrIdentityHubScreen } from "@app/screens/nostr/identity-hub/nostr-identity-hub-screen"
import { useNostrIdentity } from "@app/screens/nostr/identity-hub/use-nostr-identity"
import { usePayLinks } from "@app/screens/settings-screen/settings/use-pay-links"
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
    <RootNavigator.Screen
      name="nostrSettings"
      component={NostrSettings}
      options={{ title: LL.NostrSettingsScreen.title() }}
    />
    <RootNavigator.Screen
      name="nostrReplaceChoice"
      component={NostrReplaceChoice}
      options={{ title: LL.NostrReplaceChoiceScreen.title() }}
    />
    <RootNavigator.Screen
      name="btcpaySetup"
      component={NostrBtcpaySetup}
      options={{ title: LL.BtcpaySetupScreen.title() }}
    />
    {/* Approval surfaces (connection / request / review-all) are rendered by the
        ApprovalSurfaceHost as a state-driven full-screen overlay — NOT pushed routes — so a
        resolved approval never lingers underneath another screen. See approval-surface-host.tsx. */}
  </>
)

/** The Nostr Identity hub — empty-state (create/import) vs. summary (manage). */
export const NostrIdentityHub: React.FC = () => {
  const navigation = useNavigation<Nav>()
  const { LL } = useI18nContext()
  const { loading, npub, pubkeyHex, accountReady, reload } = useNostrIdentity()
  const [pictureUrl, setPictureUrl] = useNostrProfilePicture(pubkeyHex)
  const { uploading, pickUploadPublish } = useProfilePictureUpload()

  // Refresh on focus so a completed create/import/replace reflects immediately.
  useEffect(() => navigation.addListener("focus", reload), [navigation, reload])

  const onAddPhoto = useCallback(() => {
    pickUploadPublish()
      .then((result) => {
        if (result.ok) {
          setPictureUrl(result.url) // apply immediately — the runtime picture cache lags the publish
          toastShow({
            type: "success",
            message: LL.NostrIdentityScreen.summaryProfileImageUpdated(),
            LL,
          })
        } else if (!result.cancelled) {
          toastShow({
            type: "error",
            message: LL.NostrIdentityScreen.summaryProfileImageFailed(),
            LL,
          })
        }
      })
      .catch(() => undefined)
  }, [pickUploadPublish, setPictureUrl, LL])

  return (
    <Screen>
      <NostrIdentityHubScreen
        // Gate identity creation while the account scope is unresolvable (custodial
        // accountId not yet known): the hub shows its loading state, so create/import can
        // never write to a fallback slot (2026-08-20 per-account scoping, gate decision 3c).
        loading={loading || !accountReady}
        npub={npub}
        pubkeyHex={pubkeyHex}
        pictureUrl={pictureUrl}
        onCreate={() => navigation.navigate("nostrCreateIdentity")}
        onImport={() => navigation.navigate("nostrImportIdentity")}
        onConnectedClients={() => navigation.navigate("nostrConnectedClients")}
        onSettings={() => navigation.navigate("nostrSettings")}
        onAddPhoto={onAddPhoto}
        photoBusy={uploading}
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

/** nsec backup: method chooser (Drive / Password Manager / Manual) → exit back to the hub. */
export const NostrBackup: React.FC = () => {
  const navigation = useNavigation<Nav>()
  return (
    <Screen>
      <NostrBackupNavigator onExit={() => navigation.goBack()} />
    </Screen>
  )
}

/** Nostr settings hub — Back up / Replace, moved off the Identity hub. */
export const NostrSettings: React.FC = () => {
  const navigation = useNavigation<Nav>()
  const nostr = useNostrRuntime()
  const { LL } = useI18nContext()
  const [backupMethod, setBackupMethod] = useState<string | null>(null)

  // Per-account backup status under the backup row; refreshed on focus (a completed backup
  // flow writes the marker before exiting back here).
  useEffect(() => {
    const load = () => {
      const key = nostr?.accountKey
      if (!key) {
        setBackupMethod(null)
        return
      }
      loadString(nostrBackupDoneKey(key))
        .then(setBackupMethod)
        .catch(() => undefined)
    }
    load()
    return navigation.addListener("focus", load)
  }, [navigation, nostr?.accountKey])

  const methodLabel =
    backupMethod === "cloud"
      ? LL.NostrBackupScreen.methodCloud()
      : backupMethod === "keychain"
        ? LL.BackupScreen.BackupMethod.passwordManager()
        : backupMethod === "manual"
          ? LL.NostrBackupScreen.methodManual()
          : null
  const backupStatus = methodLabel
    ? LL.NostrBackupScreen.statusBackedUpMethod({ method: methodLabel })
    : LL.NostrBackupScreen.statusNotBackedUp()

  return (
    <Screen>
      <NostrSettingsScreen
        onBackup={() => navigation.navigate("nostrBackup")}
        onReplace={() => navigation.navigate("nostrReplaceChoice")}
        backupStatus={backupStatus}
      />
    </Screen>
  )
}

/** Replace-identity choice: import an existing key OR create a brand-new one (with consent). */
export const NostrReplaceChoice: React.FC = () => {
  const navigation = useNavigation<Nav>()
  return (
    <Screen>
      <NostrReplaceChoiceScreen
        onImport={() => navigation.navigate("nostrImportIdentity")}
        onCreateNew={() => navigation.navigate("nostrCreateIdentity")}
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
        if (!match) return
        const name = match.metadata.name ?? `${clientPubkey.slice(0, 12)}…`
        const host = match.metadata.url ? normalizeHost(match.metadata.url) : null
        navigation.setOptions({
          headerTitle: () => (
            <NostrActivityHeaderTitle
              name={name}
              image={match.metadata.image}
              host={host ?? undefined}
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

/** Local marker that the one-tap BTCPay setup completed at least once (drives the variant).
 *  Per-account (2026-08-20): suffixed with the account scope key. */
const btcpaySetupDoneKey = (accountKey: string | null): string =>
  `nostr.btcpaySetupDone.${accountKey ?? "unknown"}`

/**
 * One-tap BTCPay setup: first/returning interstitial → brief deliberate working moment →
 * locally-signed NIP-98 magic link opened in the mobile browser (the plugin signs the session
 * in and, for a new user, auto-provisions the store from the lnaddress tag). No identity yet
 * routes into the ceremony instead (funnel gap 1).
 */
export const NostrBtcpaySetup: React.FC = () => {
  const navigation = useNavigation<Nav>()
  const nostr = useNostrRuntime()
  const accountKey = nostr?.accountKey ?? null
  const { username } = usePayLinks()
  const {
    appConfig: {
      galoyInstance: { lnAddressHostname },
    },
  } = useAppConfig()
  const [variant, setVariant] = useState<BtcpaySetupVariant>("first")
  const [phase, setPhase] = useState<BtcpaySetupPhase>("intro")

  const lnAddress =
    normalizeLightningAddress(
      username ? `${username}@${lnAddressHostname}` : undefined,
    ) ?? ""

  // Returning detection: the per-account done-marker, OR a QR-era NIP-46 connection to the
  // instance (setups from before the in-app entry point existed).
  useEffect(() => {
    let cancelled = false
    const detect = async () => {
      if ((await loadString(btcpaySetupDoneKey(accountKey))) === "1") {
        if (!cancelled) setVariant("returning")
        return
      }
      const host = normalizeHost(BTCPAY_INSTANCE_URL)
      const records = (await nostr?.runtime.listConnections()) ?? []
      if (records.some((r) => r.metadata.url && normalizeHost(r.metadata.url) === host)) {
        if (!cancelled) setVariant("returning")
      }
    }
    detect().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [nostr, accountKey])

  // Leaving mid-working (e.g. no identity → ceremony) must not strand the spinner on return.
  useEffect(
    () =>
      navigation.addListener("focus", () =>
        setPhase((p) => (p === "working" ? "intro" : p)),
      ),
    [navigation],
  )

  const openDashboard = useCallback(async () => {
    if (!nostr) return
    setPhase("working")
    // Deliberate minimum on-screen time for the working moment — the local sign is instant,
    // but the transition should read as a real step, not a flicker.
    const hold = new Promise((resolve) => {
      setTimeout(resolve, 2000)
    })
    try {
      // M1 fix (audit): bind a short validity window into the signed event (NIP-98 mandates
      // an `expiration` tag). The magic link carries a full signed login in a GET query —
      // history/sync/log exposure is inherent to that POC design, but a 120s window caps the
      // replay value of a leaked URL.
      const tags: string[][] = [
        ["u", btcpayNip98LoginUrl()],
        ["method", "GET"],
        ["expiration", String(Math.floor(Date.now() / 1000) + 120)],
      ]
      if (lnAddress) tags.push(["lnaddress", lnAddress])
      const [signed] = await Promise.all([
        nostr.runtime.signAuthEvent({
          kind: NIP98_KIND,
          // eslint-disable-next-line camelcase
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: "",
        }),
        hold,
      ])
      Linking.openURL(buildBtcpayLoginUrl(signed))
      // Record the magic-link sign-in as a (synthetic, inert) connection so the service shows
      // up in Connected apps — the magic link itself creates no NIP-46 connection.
      nostr.runtime
        .recordWebSignIn({
          name: `BTCPay Server (${normalizeHost(BTCPAY_INSTANCE_URL) ?? BTCPAY_INSTANCE_URL})`,
          url: BTCPAY_INSTANCE_URL,
          image: BTCPAY_INSTANCE_IMAGE,
        })
        .catch(() => undefined)
      saveString(btcpaySetupDoneKey(accountKey), "1").catch(() => undefined)
      setPhase("done")
    } catch {
      // No nostr identity yet (nsec unavailable) — create one first.
      navigation.navigate("nostrIdentity")
    }
  }, [nostr, lnAddress, navigation, accountKey])

  return (
    <Screen preset="fixed">
      <BtcpaySetupScreen
        variant={variant}
        phase={phase}
        lnAddress={lnAddress}
        onPrimary={openDashboard}
        onOpenAgain={openDashboard}
      />
    </Screen>
  )
}
