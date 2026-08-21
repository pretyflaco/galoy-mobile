import React from "react"
import { Platform, ScrollView, View } from "react-native"

import { Text, makeStyles, useTheme } from "@rn-vui/themed"

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
  onNotNow: () => void
}

/**
 * Nostr backup method chooser (2026-08-21) — mirrors the Spark recovery-phrase backup method
 * screen: cloud (Google Drive) / Password Manager / Manual. NO password prompt here: the
 * encrypt-with-password option lives only inside the Google Drive path.
 */
export const NostrBackupMethodScreen: React.FC<Props> = ({
  busy,
  onCloud,
  onPasswordManager,
  onManual,
  onNotNow,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const T = LL.NostrBackupScreen

  const cloudProvider = getCloudProviderName(LL)
  // POC Android-only, matching the Spark flow's current iOS TODO.
  const showPasswordManager = Platform.OS === "android"

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text type="h1" style={styles.title}>
        {T.methodTitle()}
      </Text>
      <Text type="p1" style={styles.body}>
        {T.methodSubtitle()}
      </Text>

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
          title={LL.BackupScreen.BackupMethod.manualBackup()}
          onPress={onManual}
          {...testProps("nostr-backup-manual")}
        />
        <GaloySecondaryButton
          title={T.notNow()}
          onPress={onNotNow}
          {...testProps("nostr-backup-not-now")}
        />
      </View>
      <Text type="p2" style={{ color: colors.grey2 }}>
        {T.methodFootnote()}
      </Text>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: { padding: 24, rowGap: 16 },
  title: { color: colors.grey0 },
  body: { color: colors.grey1 },
  actions: { marginTop: 8, rowGap: 12 },
}))
