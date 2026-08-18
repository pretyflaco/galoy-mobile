import React, { useState } from "react"
import { Image, Modal, ScrollView, TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { QrCodeComponent } from "@app/components/totp-export/totp-qr"
import { useClipboard } from "@app/hooks/use-clipboard"
import { useI18nContext } from "@app/i18n/i18n-react"
import { toastShow } from "@app/utils/toast"
import { testProps } from "@app/utils/testProps"

import { IdenticonView } from "@app/screens/nostr/create-identity/identicon-view"

type Props = {
  /** The user's public npub (bech32) when an identity exists, else null (empty-state). */
  npub: string | null
  /** The identity's x-only pubkey (hex) for the identicon; null in empty-state. */
  pubkeyHex: string | null
  /** The fetched kind-0 profile picture URL, or null (→ identicon placeholder). */
  pictureUrl: string | null
  loading: boolean
  onCreate: () => void
  onImport: () => void
  onConnectedClients: () => void
  onSettings: () => void
}

const truncateNpub = (npub: string): string =>
  npub.length > 20 ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : npub

const AVATAR_SIZE = 96

/**
 * The Nostr Identity hub (Story A2) — the settings entry point for the signer. Empty-state
 * (no identity → create/import) vs. summary (identity exists). The summary leads with a profile
 * hero: the identity's avatar (its kind-0 `picture` pulled from profile relays, else a
 * deterministic identicon placeholder) with an "add photo" affordance, the npub with copy + QR
 * buttons, then Connected clients and Settings. Scan-to-connect lives ONLY on the Home screen.
 * The nsec is NEVER rendered.
 */
export const NostrIdentityHubScreen: React.FC<Props> = ({
  npub,
  pubkeyHex,
  pictureUrl,
  loading,
  onCreate,
  onImport,
  onConnectedClients,
  onSettings,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrIdentityScreen
  const { copyToClipboard } = useClipboard()
  const [revealed, setRevealed] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

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

  const onCopyNpub = () =>
    copyToClipboard({ content: npub, message: T.summaryNpubCopied() })

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      {...testProps("nostr-identity-hub-summary")}
    >
      {/* Profile hero: avatar (kind-0 picture) or identicon placeholder + add-photo affordance. */}
      <View style={styles.hero}>
        <View style={styles.avatarWrap}>
          {pictureUrl ? (
            <Image
              source={{ uri: pictureUrl }}
              style={styles.avatarImage}
              {...testProps("nostr-identity-avatar-image")}
            />
          ) : (
            <IdenticonView
              pubkeyHex={pubkeyHex ?? ""}
              size={AVATAR_SIZE}
              accessibilityLabel={T.summaryAvatarA11y()}
            />
          )}
          <TouchableOpacity
            style={styles.editBadge}
            accessibilityRole="button"
            onPress={() =>
              toastShow({
                type: "success",
                message: T.summaryProfileImageComingSoon(),
                LL,
              })
            }
            {...testProps("nostr-identity-add-photo")}
            accessibilityLabel={T.summaryAddProfileImage()}
          >
            <GaloyIcon name="pencil" size={16} color={styles.editIcon.color} />
          </TouchableOpacity>
        </View>
      </View>

      {/* npub row: label, revealable value, copy + QR affordances. */}
      <Text type="p3" style={styles.addressLabel}>
        {T.summaryPublicAddressLabel()}
      </Text>
      <View style={styles.npubRow}>
        <TouchableOpacity
          style={styles.npubTap}
          onPress={() => setRevealed((v) => !v)}
          {...testProps("nostr-identity-npub")}
        >
          <Text type="p2" numberOfLines={1}>
            {revealed ? npub : truncateNpub(npub)}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onCopyNpub}
          accessibilityRole="button"
          {...testProps("nostr-identity-copy-npub")}
          accessibilityLabel={T.summaryCopyNpub()}
        >
          <GaloyIcon name="copy-paste" size={20} color={styles.npubIcon.color} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setQrOpen(true)}
          accessibilityRole="button"
          {...testProps("nostr-identity-show-qr")}
          accessibilityLabel={T.summaryShowQr()}
        >
          <GaloyIcon name="qr-code" size={20} color={styles.npubIcon.color} />
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={T.summaryConnectedClients()}
          onPress={onConnectedClients}
          {...testProps("nostr-identity-connected-clients")}
        />
        <GaloySecondaryButton
          title={T.summarySettings()}
          onPress={onSettings}
          {...testProps("nostr-identity-settings")}
        />
      </View>

      {/* npub QR overlay. */}
      <Modal
        visible={qrOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setQrOpen(false)}
      >
        <TouchableOpacity
          style={styles.qrBackdrop}
          activeOpacity={1}
          onPress={() => setQrOpen(false)}
          {...testProps("nostr-identity-qr-backdrop")}
        >
          <View style={styles.qrCard}>
            <Text type="h2" style={styles.qrTitle}>
              {T.summaryQrTitle()}
            </Text>
            <QrCodeComponent value={npub} />
            <GaloySecondaryButton
              title={T.summaryQrClose()}
              onPress={() => setQrOpen(false)}
              {...testProps("nostr-identity-qr-close")}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    padding: 20,
    rowGap: 14,
  },
  body: {
    color: colors.grey3,
  },
  hero: {
    alignItems: "center",
    marginVertical: 8,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: 8,
    backgroundColor: colors.grey4,
  },
  editBadge: {
    position: "absolute",
    right: -6,
    bottom: -6,
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: colors.grey5,
    borderWidth: 1,
    borderColor: colors.grey4,
    alignItems: "center",
    justifyContent: "center",
  },
  editIcon: {
    color: colors.grey0,
  },
  addressLabel: {
    color: colors.grey3,
  },
  npubRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  npubTap: {
    flexShrink: 1,
    flexGrow: 1,
  },
  npubIcon: {
    color: colors.grey1,
  },
  actions: {
    rowGap: 10,
    marginTop: 8,
  },
  qrBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  qrCard: {
    backgroundColor: colors.grey5,
    borderRadius: 16,
    padding: 20,
    rowGap: 14,
    alignItems: "center",
  },
  qrTitle: {
    color: colors.black,
  },
}))
