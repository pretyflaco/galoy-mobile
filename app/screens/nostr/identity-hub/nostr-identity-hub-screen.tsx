import React, { useState } from "react"
import { ScrollView, TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  /** The user's public npub (bech32) when an identity exists, else null (empty-state). */
  npub: string | null
  loading: boolean
  onCreate: () => void
  onImport: () => void
  onBackup: () => void
  onReplace: () => void
  onConnectedClients: () => void
  onScanToConnect: () => void
}

const truncateNpub = (npub: string): string =>
  npub.length > 20 ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : npub

/**
 * The Nostr Identity hub (Story A2) — the settings entry point for the signer. Decides
 * empty-state (no identity → create/import) vs. summary (identity exists → backup, replace,
 * connected clients, scan-to-connect). Navigation-agnostic: all routing is via injected
 * callbacks (AD-1 discipline, matching the other nostr screens). The nsec is NEVER rendered;
 * only the public npub appears, de-emphasized and truncated.
 */
export const NostrIdentityHubScreen: React.FC<Props> = ({
  npub,
  loading,
  onCreate,
  onImport,
  onBackup,
  onReplace,
  onConnectedClients,
  onScanToConnect,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrIdentityScreen
  const [revealed, setRevealed] = useState(false)

  if (loading) {
    return (
      <View style={styles.container} {...testProps("nostr-identity-hub-loading")}>
        <Text type="p2">{T.title()}</Text>
      </View>
    )
  }

  if (!npub) {
    return (
      <ScrollView
        contentContainerStyle={styles.container}
        {...testProps("nostr-identity-hub-empty")}
      >
        <Text type="h1" bold>
          {T.emptyTitle()}
        </Text>
        <Text type="p2" style={styles.body}>
          {T.emptyBody()}
        </Text>
        <GaloyPrimaryButton
          title={T.emptyCreate()}
          onPress={onCreate}
          {...testProps("nostr-identity-create")}
        />
        <GaloySecondaryButton
          title={T.emptyImport()}
          onPress={onImport}
          {...testProps("nostr-identity-import")}
        />
      </ScrollView>
    )
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      {...testProps("nostr-identity-hub-summary")}
    >
      <Text type="p3" style={styles.addressLabel}>
        {T.summaryPublicAddressLabel()}
      </Text>
      <TouchableOpacity
        onPress={() => setRevealed(true)}
        {...testProps("nostr-identity-npub")}
      >
        <Text type="p2">{revealed ? npub : truncateNpub(npub)}</Text>
      </TouchableOpacity>

      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={T.summaryScanToConnect()}
          onPress={onScanToConnect}
          {...testProps("nostr-identity-scan-to-connect")}
        />
        <GaloySecondaryButton
          title={T.summaryConnectedClients()}
          onPress={onConnectedClients}
          {...testProps("nostr-identity-connected-clients")}
        />
        <GaloySecondaryButton
          title={T.summaryBackup()}
          onPress={onBackup}
          {...testProps("nostr-identity-backup")}
        />
        <GaloySecondaryButton
          title={T.summaryReplace()}
          onPress={onReplace}
          {...testProps("nostr-identity-replace")}
        />
      </View>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    padding: 20,
    rowGap: 16,
  },
  body: {
    color: colors.grey3,
  },
  addressLabel: {
    color: colors.grey3,
  },
  actions: {
    rowGap: 12,
    marginTop: 8,
  },
}))
