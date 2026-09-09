import React, { useState } from "react"
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native"

import { Avatar, Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { QrCodeComponent } from "@app/components/totp-export/totp-qr"
import { useClipboard } from "@app/hooks/use-clipboard"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

import { IdenticonView } from "@app/screens/nostr/create-identity/identicon-view"
import {
  formatConnectedAt,
  sortConnectedClientsByNewest,
  type ConnectedClient,
} from "@app/screens/nostr/connected-clients-section"

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
  /** Connected apps for the inline list (newest first ordering applied here). */
  clients: ConnectedClient[]
  /** Row tap → the connected-app activity screen. */
  onClientPress: (clientPubkey: string) => void
  /** Trash → warning-confirm → atomic disconnect (ConnectionStore.disconnect). */
  onDisconnect: (clientPubkey: string) => void
  /** The Hub's PRIMARY action (spec §7.5): scan a NIP-46 sign-in QR. Shares the Home scanner. */
  onScan: () => void
  /** Show the "Backup your keys" banner (random/imported keys until a backup completes). */
  showBackupBanner: boolean
  /** Banner tap → the Choose your backup method flow. */
  onBackup: () => void
  /** Pick → NIP-96 upload → kind-0 publish (2026-08-21). */
  onAddPhoto: () => void
  /** True while the upload/publish flow is running (disables the affordance). */
  photoBusy: boolean
}

const truncateNpub = (npub: string): string =>
  npub.length > 24 ? `${npub.slice(0, 12)}...${npub.slice(-12)}` : npub

const AVATAR_SIZE = 114

/**
 * The Nostr Identity Hub (spec §7.5, Figma 23301:105853 / -empty 23233:102486 /
 * -backup-alert 23296:105076): backup banner (while un-backed-up), avatar + pencil,
 * the public address with copy + QR, the inline Connected apps list with revoke, and
 * Scan as the pinned primary action. Settings moved to the header gear (route wrapper).
 * The nsec is NEVER rendered.
 */
export const NostrIdentityHubScreen: React.FC<Props> = ({
  npub,
  pubkeyHex,
  pictureUrl,
  loading,
  onCreate,
  onImport,
  clients,
  onClientPress,
  onDisconnect,
  onScan,
  showBackupBanner,
  onBackup,
  onAddPhoto,
  photoBusy,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrIdentityScreen
  const TC = LL.NostrConnectedClientsScreen
  const { copyToClipboard } = useClipboard()
  const [qrOpen, setQrOpen] = useState(false)
  const [pendingDisconnect, setPendingDisconnect] = useState<ConnectedClient | null>(null)

  if (loading) {
    return (
      <View style={styles.loadingContainer} {...testProps("nostr-identity-hub-loading")}>
        <Text type="p2">{T.title()}</Text>
      </View>
    )
  }

  // Create or import (spec §7.2, Figma 23233:102416) — reached from the settings row
  // when no identity exists yet.
  if (!npub) {
    return (
      <View style={styles.container} {...testProps("nostr-identity-hub-empty")}>
        <View style={styles.hero}>
          <View style={styles.emptyIconCircle}>
            <GaloyIcon name="nostr" width={32} height={32} color={styles.icon.color} />
          </View>
          <Text type="h2" bold style={styles.emptyTitle}>
            {T.emptyTitle()}
          </Text>
          <Text type="p2" style={styles.emptyBody}>
            {T.emptyBody()}
          </Text>
        </View>
        <View style={styles.bottomActions}>
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
        </View>
      </View>
    )
  }

  const onCopyNpub = () =>
    copyToClipboard({ content: npub, message: T.summaryNpubCopied() })

  // Revoke confirm (recoverable → inherited {warning} styling, never consent-danger).
  if (pendingDisconnect) {
    return (
      <View
        style={styles.warningCard}
        accessible
        accessibilityLabel={TC.srLabel({ client: pendingDisconnect.name })}
        testID="nostr-disconnect-confirm"
      >
        <Text type="h2" style={styles.warningTitle}>
          {TC.confirmTitle({ client: pendingDisconnect.name })}
        </Text>
        <Text type="p1" style={styles.warningBody}>
          {TC.confirmBody()}
        </Text>
        <View style={styles.warningActions}>
          <GaloySecondaryButton
            title={TC.confirmCancel()}
            onPress={() => setPendingDisconnect(null)}
            testID="nostr-disconnect-confirm-cancel"
          />
          <GaloyPrimaryButton
            title={TC.confirmDisconnect()}
            onPress={() => {
              onDisconnect(pendingDisconnect.clientPubkey)
              setPendingDisconnect(null)
            }}
            testID="nostr-disconnect-confirm-yes"
          />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container} {...testProps("nostr-identity-hub-summary")}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Backup banner (spec §7.5): non-dismissible, persists until a backup completes. */}
        {showBackupBanner ? (
          <TouchableOpacity
            style={styles.backupBanner}
            accessibilityRole="button"
            onPress={onBackup}
            {...testProps("nostr-identity-backup-banner")}
          >
            <View style={styles.backupBannerText}>
              <Text type="p3" bold style={styles.backupBannerTitle}>
                {T.backupBannerTitle()}
              </Text>
              <Text type="p3" style={styles.backupBannerBody}>
                {T.backupBannerBody()}
              </Text>
            </View>
            <GaloyIcon
              name="caret-right"
              size={16}
              weight="bold"
              color={styles.backupBannerTitle.color}
            />
          </TouchableOpacity>
        ) : null}

        {/* Profile hero: avatar (kind-0 picture) or identicon placeholder + pencil badge. */}
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
              disabled={photoBusy}
              onPress={onAddPhoto}
              {...testProps("nostr-identity-add-photo")}
              accessibilityLabel={T.summaryAddProfileImage()}
            >
              {photoBusy ? (
                <ActivityIndicator size="small" color={styles.editIcon.color} />
              ) : (
                <GaloyIcon name="pencil" size={16} color={styles.editIcon.color} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Your public address: truncated npub + copy, QR in its own square card. */}
        <Text type="p3" style={styles.sectionLabel}>
          {T.summaryPublicAddressLabel()}
        </Text>
        <View style={styles.addressRow}>
          <View style={styles.addressCard}>
            <Text
              type="p4"
              numberOfLines={1}
              style={styles.addressText}
              {...testProps("nostr-identity-npub")}
            >
              {truncateNpub(npub)}
            </Text>
            <TouchableOpacity
              onPress={onCopyNpub}
              accessibilityRole="button"
              {...testProps("nostr-identity-copy-npub")}
              accessibilityLabel={T.summaryCopyNpub()}
            >
              <GaloyIcon name="copy-paste" size={16} color={styles.rowIcon.color} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.qrSquare}
            accessibilityRole="button"
            onPress={() => setQrOpen(true)}
            {...testProps("nostr-identity-show-qr")}
            accessibilityLabel={T.summaryShowQr()}
          >
            <GaloyIcon name="qr-code" size={16} color={styles.rowIcon.color} />
          </TouchableOpacity>
        </View>

        {/* Connected apps: inline list (tap → activity, trash → revoke) or the grey7
            inactive empty surface. */}
        <Text type="p3" style={styles.sectionLabel}>
          {TC.sectionTitle()}
        </Text>
        {clients.length === 0 ? (
          <View style={styles.emptyClientsCard}>
            <Text type="p3" style={styles.emptyClientsText} testID="nostr-clients-empty">
              {TC.empty()}
            </Text>
          </View>
        ) : (
          <View style={styles.clientsCard}>
            {sortConnectedClientsByNewest(clients).map((client, index) => (
              <View key={client.clientPubkey}>
                {index > 0 ? <View style={styles.rowDivider} /> : null}
                <View style={styles.clientRow}>
                  <TouchableOpacity
                    style={styles.clientRowMain}
                    accessibilityRole="button"
                    accessibilityLabel={TC.rowA11y({ client: client.name })}
                    onPress={() => onClientPress(client.clientPubkey)}
                    testID={`nostr-client-row-${client.clientPubkey}`}
                  >
                    <Avatar
                      rounded
                      size={24}
                      {...(client.image
                        ? { source: { uri: client.image } }
                        : { title: (client.name || "?").charAt(0).toUpperCase() })}
                      containerStyle={styles.clientAvatar}
                    />
                    <View style={styles.clientTextCol}>
                      <Text type="p3" numberOfLines={1} style={styles.clientName}>
                        {client.name}
                      </Text>
                      {client.createdAt ? (
                        <Text type="p3" style={styles.clientMeta}>
                          {formatConnectedAt(client.createdAt)}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => setPendingDisconnect(client)}
                    testID={`nostr-client-disconnect-${client.clientPubkey}`}
                  >
                    <GaloyIcon name="trash" size={16} color={styles.rowIcon.color} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Scan — the Hub's primary action (spec §7.5); shares the Home scanner route. */}
      <View style={styles.bottomActions}>
        <GaloyPrimaryButton
          title={T.summaryScan()}
          onPress={onScan}
          {...testProps("nostr-identity-scan")}
          accessibilityLabel={T.summaryScanA11y()}
        />
      </View>

      {/* Your public address QR modal (Figma 23301:105231). */}
      <Modal
        visible={qrOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setQrOpen(false)}
      >
        <View style={styles.qrBackdrop}>
          <View style={styles.qrCard}>
            <TouchableOpacity
              style={styles.qrCloseIcon}
              accessibilityRole="button"
              onPress={() => setQrOpen(false)}
              {...testProps("nostr-identity-qr-close-icon")}
            >
              <GaloyIcon name="close" size={20} color={styles.icon.color} />
            </TouchableOpacity>
            <Text type="h1" bold style={styles.qrTitle}>
              {T.summaryQrTitle()}
            </Text>
            <QrCodeComponent value={npub} />
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onCopyNpub}
              {...testProps("nostr-identity-qr-copy")}
            >
              <Text type="p4" style={styles.qrAddress}>
                {npub}
              </Text>
            </TouchableOpacity>
            <GaloySecondaryButton
              title={T.summaryQrClose()}
              onPress={() => setQrOpen(false)}
              containerStyle={styles.qrCloseButton}
              {...testProps("nostr-identity-qr-close")}
            />
          </View>
        </View>
      </Modal>
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
  },
  loadingContainer: {
    padding: 20,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    rowGap: 14,
  },
  icon: {
    color: colors.grey0,
  },
  hero: {
    alignItems: "center",
    paddingTop: 10,
  },
  emptyIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.grey5,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: colors.grey0,
    textAlign: "center",
  },
  emptyBody: {
    color: colors.grey1,
    textAlign: "center",
  },
  backupBanner: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 14,
    backgroundColor: colors.grey5,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 8,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 10,
  },
  backupBannerText: {
    flex: 1,
  },
  backupBannerTitle: {
    color: colors.warning,
  },
  backupBannerBody: {
    color: colors.grey0,
  },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  avatarImage: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.grey4,
  },
  editBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.grey5,
    borderWidth: 1,
    borderColor: colors.grey4,
    alignItems: "center",
    justifyContent: "center",
  },
  editIcon: {
    color: colors.grey0,
  },
  sectionLabel: {
    color: colors.grey0,
  },
  addressRow: {
    flexDirection: "row",
    columnGap: 10,
  },
  addressCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 14,
    backgroundColor: colors.grey5,
    borderRadius: 8,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 10,
  },
  addressText: {
    flexShrink: 1,
    color: colors.grey3,
  },
  qrSquare: {
    width: 46,
    backgroundColor: colors.grey5,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowIcon: {
    color: colors.grey0,
  },
  emptyClientsCard: {
    backgroundColor: colors.grey7,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  emptyClientsText: {
    color: colors.grey3,
  },
  clientsCard: {
    backgroundColor: colors.grey5,
    borderRadius: 8,
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.grey4,
    marginHorizontal: 14,
  },
  clientRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 10,
  },
  clientRowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  clientAvatar: {
    backgroundColor: colors.grey4,
  },
  clientTextCol: {
    flex: 1,
    minWidth: 0,
  },
  clientName: {
    color: colors.grey0,
  },
  clientMeta: {
    color: colors.grey3,
  },
  bottomActions: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    rowGap: 10,
  },
  warningCard: {
    margin: 20,
    padding: 20,
    rowGap: 14,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 16,
  },
  warningTitle: {
    color: colors.grey0,
  },
  warningBody: {
    color: colors.grey0,
  },
  warningActions: {
    rowGap: 10,
  },
  qrBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  qrCard: {
    alignSelf: "stretch",
    backgroundColor: colors.grey5,
    borderRadius: 12,
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 20,
    rowGap: 20,
    alignItems: "center",
  },
  qrCloseIcon: {
    position: "absolute",
    top: 17,
    right: 17,
  },
  qrTitle: {
    color: colors.grey0,
    textAlign: "center",
  },
  qrAddress: {
    color: colors.grey3,
    textAlign: "center",
  },
  qrCloseButton: {
    alignSelf: "stretch",
  },
}))
