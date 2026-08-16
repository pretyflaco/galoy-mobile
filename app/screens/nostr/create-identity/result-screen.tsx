import React, { useState } from "react"
import { ScrollView, TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import type { NostrIdentity } from "@app/nostr/core/identity"
import { testProps } from "@app/utils/testProps"

import { IdenticonView } from "./identicon-view"

type Props = {
  identity: NostrIdentity
  onBackup: () => void
  onNotNow: () => void
}

const truncateNpub = (npub: string): string =>
  npub.length > 20 ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : npub

/**
 * Ceremony step 3 — result/ownership (Story 1.5 / Task 4,5). Identicon is the primary
 * face; ownership copy is the emotional core; the npub is a de-emphasized, labeled,
 * truncated "your public address" (tap to reveal). The nsec is NEVER rendered. The
 * backup card offers a prominent primary and a non-punitive "Not now".
 */
export const NostrCreateIdentityResultScreen: React.FC<Props> = ({
  identity,
  onBackup,
  onNotNow,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrCreateIdentityScreen
  const [revealed, setRevealed] = useState(false)

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.identiconWrap}>
        <IdenticonView
          pubkeyHex={identity.pubKeyHex}
          accessibilityLabel={T.identiconA11y()}
        />
      </View>

      <Text type="h2" style={styles.ownership}>
        {T.resultOwnership()}
      </Text>
      <Text type="p2" style={styles.body}>
        {T.resultOneIdentity()}
      </Text>

      <View style={styles.addressBlock}>
        <Text type="p3" style={styles.addressLabel}>
          {T.resultPublicAddressLabel()}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => setRevealed((v) => !v)}
          {...testProps("nostr-npub-reveal")}
        >
          <Text
            type="p3"
            style={styles.npub}
            numberOfLines={1}
            ellipsizeMode="middle"
            {...testProps("nostr-npub")}
          >
            {revealed ? identity.npub : truncateNpub(identity.npub)}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.backupCard}>
        <Text type="p1" style={styles.backupTitle}>
          {T.backupTitle()}
        </Text>
        <Text type="p2" style={styles.body}>
          {T.backupBody()}
        </Text>
        <GaloyPrimaryButton
          title={T.backupCta()}
          onPress={onBackup}
          {...testProps("nostr-backup-key")}
        />
        <GaloySecondaryButton
          title={T.backupNotNow()}
          onPress={onNotNow}
          {...testProps("nostr-backup-not-now")}
        />
      </View>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: { padding: 24, rowGap: 16 },
  identiconWrap: { alignItems: "center", marginVertical: 16 },
  ownership: { color: colors.grey0, textAlign: "center" },
  body: { color: colors.grey1 },
  addressBlock: { marginTop: 8, rowGap: 4 },
  addressLabel: { color: colors.grey2 },
  npub: { color: colors.grey2 },
  backupCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.grey5,
    rowGap: 12,
  },
  backupTitle: { color: colors.grey0 },
}))
