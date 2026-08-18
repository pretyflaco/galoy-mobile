import React, { useState } from "react"
import { ScrollView, TouchableOpacity, View } from "react-native"

import Clipboard from "@react-native-clipboard/clipboard"
import { LinearGradient } from "react-native-linear-gradient"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import type { NostrIdentity } from "@app/nostr/core/identity"
import { testProps } from "@app/utils/testProps"
import { toastShow } from "@app/utils/toast"

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

  const onCopyNpub = () => {
    Clipboard.setString(identity.npub)
    toastShow({
      message: () => T.resultCopied(),
      type: "success",
      LL,
    })
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Ownership moment: the one place the Blink gradient is permitted (DESIGN.md) —
          a gradient hero ring frames the identicon; body copy never sits on the gradient. */}
      <View style={styles.identiconWrap}>
        <LinearGradient
          colors={["#ffbe0b", "#fb5607"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroRing}
        >
          <View style={styles.heroInner}>
            <IdenticonView
              pubkeyHex={identity.pubKeyHex}
              accessibilityLabel={T.identiconA11y()}
            />
          </View>
        </LinearGradient>
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
        <View style={styles.addressRow}>
          <TouchableOpacity
            style={styles.npubTap}
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
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={T.resultCopy()}
            onPress={onCopyNpub}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            testID="nostr-npub-copy"
          >
            <GaloyIcon name="copy-paste" size={20} color={styles.npub.color} />
          </TouchableOpacity>
        </View>
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
  container: { padding: 20, rowGap: 14 },
  identiconWrap: { alignItems: "center", marginVertical: 14 },
  // Gradient hero ring (the ceremony ownership moment). The 12px pad forms the ring;
  // the white inner keeps the identicon on its own surface, off the gradient.
  heroRing: {
    width: 132,
    height: 132,
    borderRadius: 66,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  heroInner: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  ownership: { color: colors.grey0, textAlign: "center" },
  body: { color: colors.grey1 },
  addressBlock: { marginTop: 8, rowGap: 5 },
  addressLabel: { color: colors.grey2 },
  // Bordered "your public address" row: de-emphasized npub + a copy affordance.
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 10,
    borderWidth: 1,
    borderColor: colors.grey4,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  npubTap: { flexShrink: 1 },
  npub: { color: colors.grey2 },
  backupCard: {
    marginTop: 14,
    padding: 20,
    borderRadius: 16,
    backgroundColor: colors.grey5,
    rowGap: 14,
  },
  backupTitle: { color: colors.grey0 },
}))
