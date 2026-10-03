import React from "react"
import { Platform, ScrollView, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { getCloudProviderName } from "@app/screens/self-custodial/onboarding/utils"
import { testProps } from "@app/utils/testProps"

type Props = {
  busy: boolean
  onCloud: () => void
  onPasswordManager: () => void
  onManual: () => void
}

/**
 * Choose your backup method (spec §7.8, Figma 23266:104450) — cloud (Google Drive /
 * Apple iCloud) / Password manager / Manual backup. NO password prompt here: the
 * encrypt-with-password option lives only inside the Google Drive path. Backup stays
 * optional (FR-8): back always exits; the Hub banner + Home alert simply persist.
 */
export const NostrBackupMethodScreen: React.FC<Props> = ({
  busy,
  onCloud,
  onPasswordManager,
  onManual,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrBackupScreen

  const cloudProvider = getCloudProviderName(LL)
  // POC Android-only, matching the Spark flow's current iOS TODO.
  const showPasswordManager = Platform.OS === "android"

  return (
    <View style={styles.container} {...testProps("nostr-backup-method")}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.iconCircle}>
            <GaloyIcon name="cloud" size={32} color={styles.icon.color} />
          </View>
          <Text type="h2" bold style={styles.title}>
            {T.methodTitle()}
          </Text>
          <Text type="p1" style={styles.body}>
            {T.methodSubtitle()}
          </Text>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={cloudProvider}
          onPress={onCloud}
          loading={busy}
          {...testProps("nostr-backup-cloud")}
        />
        {showPasswordManager && (
          <GaloySecondaryButton
            title={LL.BackupScreen.BackupMethod.passwordManager()}
            onPress={onPasswordManager}
            loading={busy}
            {...testProps("nostr-backup-password-manager")}
          />
        )}
        <GaloySecondaryButton
          title={T.methodManual()}
          onPress={onManual}
          {...testProps("nostr-backup-manual")}
        />
      </View>
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    justifyContent: "space-between",
  },
  content: {
    padding: 20,
  },
  hero: {
    alignItems: "center",
    rowGap: 14,
    paddingVertical: 20,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.grey5,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    color: colors.grey0,
  },
  title: {
    color: colors.grey0,
    textAlign: "center",
  },
  body: {
    color: colors.grey1,
    textAlign: "center",
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    rowGap: 10,
  },
}))
