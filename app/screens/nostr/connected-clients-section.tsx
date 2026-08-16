import React, { useState } from "react"
import { View } from "react-native"

import { ListItem, Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

export interface ConnectedClient {
  clientPubkey: string
  /** The app identity (name) from the connection metadata. */
  name: string
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
            <ListItem.Content>
              <ListItem.Title>{client.name}</ListItem.Title>
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
