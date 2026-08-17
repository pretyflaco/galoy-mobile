import React, { useState } from "react"
import { View } from "react-native"

import { Avatar, ListItem, Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

export interface ConnectedClient {
  clientPubkey: string
  /** The app identity (name) from the connection metadata. */
  name: string
  /** The relays this client is reached on (from the nostrconnect:// URI). */
  relays?: string[]
  /** Optional avatar image URL from the connection metadata (NIP-46 `image`). */
  image?: string
  /** Unix seconds the connection was created. */
  createdAt?: number
}

/** first8:last8 of the client pubkey — the Amber-style disambiguating fingerprint. */
const pubkeyPair = (pubkey: string): string =>
  pubkey.length >= 16 ? `${pubkey.slice(0, 8)}:${pubkey.slice(-8)}` : pubkey

/** "HH:MM - DD Mon" (Amber-style connected-at). */
const formatConnectedAt = (createdAt?: number): string => {
  if (!createdAt) return ""
  const d = new Date(createdAt * 1000)
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const day = d.toLocaleDateString([], { day: "2-digit", month: "short" })
  return `${time} - ${day}`
}

type Props = {
  clients: ConnectedClient[]
  /** Trigger the atomic disconnect for a pubkey (ConnectionStore.disconnect). */
  onDisconnect: (clientPubkey: string) => void
}

/**
 * Connected clients section (Story 3.7 / FR-13) — the trust-critical list-and-revoke FLOOR on
 * the Nostr Identity screen. Reads the connected clients ONLY through ConnectionStore (passed
 * in as `clients`); the screen never touches persistence or grant state directly. Each row has
 * an EXPLICIT Disconnect button (never gesture-only). Disconnect opens a {warning}-styled
 * confirm dialog stating the effect — recoverable (the client can reconnect with approval), so
 * it uses inherited {warning} (border/icon/accent only; body text grey0), NOT the
 * {consent-danger} red reserved for irreversible surfaces. No session-management dashboard.
 * All copy is i18n-sourced.
 */
export const NostrConnectedClientsSection: React.FC<Props> = ({
  clients,
  onDisconnect,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrConnectedClientsScreen
  const [pending, setPending] = useState<ConnectedClient | null>(null)

  const confirm = () => {
    if (pending) onDisconnect(pending.clientPubkey)
    setPending(null)
  }

  if (pending) {
    return (
      <View
        style={styles.warningCard}
        accessible
        accessibilityLabel={T.srLabel({ client: pending.name })}
        testID="nostr-disconnect-confirm"
      >
        <Text type="h2" style={styles.warningTitle}>
          {T.confirmTitle({ client: pending.name })}
        </Text>
        {/* Body text is grey0 (never {warning} as text — fails contrast). */}
        <Text type="p1" style={styles.body}>
          {T.confirmBody()}
        </Text>
        <View style={styles.actions}>
          {/* Cancel is the default-focused control; Disconnect is the deliberate action. */}
          <GaloySecondaryButton
            title={T.confirmCancel()}
            onPress={() => setPending(null)}
            testID="nostr-disconnect-confirm-cancel"
          />
          <GaloyPrimaryButton
            title={T.confirmDisconnect()}
            onPress={confirm}
            testID="nostr-disconnect-confirm-yes"
          />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container} {...testProps("nostr-connected-clients")}>
      <Text type="h2" style={styles.sectionTitle}>
        {T.sectionTitle()}
      </Text>

      {clients.length === 0 ? (
        <Text type="p1" style={styles.empty} testID="nostr-clients-empty">
          {T.empty()}
        </Text>
      ) : (
        clients.map((client) => (
          <ListItem
            key={client.clientPubkey}
            bottomDivider
            accessibilityLabel={T.rowA11y({ client: client.name })}
            testID={`nostr-client-row-${client.clientPubkey}`}
          >
            {/* Avatar: the client's image (NIP-46 `image`) or an initial-in-circle fallback —
                mirrors Amber's Applications list so identical names are still distinguishable. */}
            <Avatar
              rounded
              size={44}
              {...(client.image
                ? { source: { uri: client.image } }
                : { title: (client.name || "?").charAt(0).toUpperCase() })}
              containerStyle={styles.avatar}
            />
            <ListItem.Content>
              <ListItem.Title style={styles.rowName}>{client.name}</ListItem.Title>
              {client.relays && client.relays.length > 0 && (
                <ListItem.Subtitle
                  style={styles.rowMeta}
                  testID={`nostr-client-relays-${client.clientPubkey}`}
                >
                  {client.relays.map((r) => r.replace(/^wss:\/\//, "")).join(", ")}
                </ListItem.Subtitle>
              )}
              <ListItem.Subtitle
                style={styles.rowMeta}
                testID={`nostr-client-fingerprint-${client.clientPubkey}`}
              >
                {pubkeyPair(client.clientPubkey)}
                {client.createdAt ? `   ${formatConnectedAt(client.createdAt)}` : ""}
              </ListItem.Subtitle>
            </ListItem.Content>
            <GaloySecondaryButton
              title={T.disconnect()}
              onPress={() => setPending(client)}
              testID={`nostr-client-disconnect-${client.clientPubkey}`}
            />
          </ListItem>
        ))
      )}
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    rowGap: 8,
  },
  sectionTitle: {
    color: colors.black,
  },
  empty: {
    color: colors.grey2,
  },
  avatar: {
    backgroundColor: colors.grey4,
  },
  rowName: {
    color: colors.black,
    fontWeight: "600",
  },
  rowMeta: {
    color: colors.grey2,
    fontSize: 12,
  },
  warningCard: {
    padding: 20,
    rowGap: 12,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 12,
  },
  warningTitle: {
    color: colors.black,
  },
  body: {
    color: colors.grey0,
  },
  actions: {
    rowGap: 8,
  },
}))
