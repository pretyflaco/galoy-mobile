import React, { useState } from "react"
import { ScrollView, View } from "react-native"

import { Text, makeStyles, useTheme } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { CheckboxRow } from "@app/components/checkbox-row"
import { InfoBanner } from "@app/components/info-banner"
import { PasswordInput } from "@app/components/password-input"
import { RichText } from "@app/components/rich-text"
import { useI18nContext } from "@app/i18n/i18n-react"
import { useCloudBackupForm } from "@app/screens/self-custodial/onboarding/hooks/use-cloud-backup-form"
import { getCloudProviderName } from "@app/screens/self-custodial/onboarding/utils"
import { testProps } from "@app/utils/testProps"

type Props = {
  busy: boolean
  /** Encrypted path (password) or the acknowledged plaintext path. */
  onUpload: (opts: { password?: string; acknowledgePlaintext?: boolean }) => void
  onCancel: () => void
}

/**
 * Nostr Google Drive backup (2026-08-21) — mirrors the Spark cloud backup screen, including
 * the encrypt checkbox + password fields. Unchecking encryption requires the explicit AD-7
 * plaintext acknowledgment before any upload call.
 */
export const NostrCloudBackupScreen: React.FC<Props> = ({ busy, onUpload, onCancel }) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const cloud = LL.BackupScreen.CloudBackup
  const T = LL.NostrBackupScreen
  const cloudProvider = getCloudProviderName(LL)
  const [showPlaintextAck, setShowPlaintextAck] = useState(false)

  const {
    isEncrypted,
    password,
    confirmPassword,
    toggleEncryption,
    setPassword,
    setConfirmPassword,
    markPasswordTouched,
    markConfirmPasswordTouched,
    passwordError,
    confirmPasswordError,
    isValid,
  } = useCloudBackupForm(true) // nostr AD-7: encrypted by default (Spark starts unchecked)

  if (showPlaintextAck) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View
          style={styles.dangerCard}
          accessible
          accessibilityLabel={T.plaintextSrLabel()}
        >
          <Text type="h2" style={styles.dangerText}>
            {T.plaintextTitle()}
          </Text>
          <Text type="p1" style={styles.dangerText}>
            {T.plaintextConsequence()}
          </Text>
        </View>
        <View style={styles.actions}>
          {/* Default-focused = the safe path; the destructive confirm is deliberate. */}
          <GaloySecondaryButton
            title={T.plaintextCancel()}
            onPress={() => setShowPlaintextAck(false)}
            {...testProps("nostr-backup-plaintext-cancel")}
          />
          <GaloyPrimaryButton
            title={T.plaintextConfirm()}
            onPress={() => onUpload({ acknowledgePlaintext: true })}
            loading={busy}
            {...testProps("nostr-backup-plaintext-confirm")}
          />
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text type="h1" style={styles.title}>
        {cloud.title()}
      </Text>
      <Text type="p1" style={styles.body}>
        {cloud.description({ provider: cloudProvider })}
      </Text>

      <CheckboxRow
        label={cloud.encryptCheckbox()}
        isChecked={isEncrypted}
        onPress={toggleEncryption}
        {...testProps("nostr-cloud-encrypt-checkbox")}
      />

      {isEncrypted && (
        <View style={styles.encryptionFields}>
          <PasswordInput
            label={cloud.password()}
            value={password}
            onChangeText={setPassword}
            onBlur={markPasswordTouched}
            placeholder={cloud.passwordPlaceholder()}
            error={passwordError}
            {...testProps("nostr-cloud-password-input")}
          />
          <PasswordInput
            label={cloud.confirmPassword()}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            onBlur={markConfirmPasswordTouched}
            placeholder={cloud.confirmPasswordPlaceholder()}
            error={confirmPasswordError}
            {...testProps("nostr-cloud-confirm-password-input")}
          />
          <InfoBanner title={cloud.importantTitle()} icon="warning" iconColor="warning">
            <RichText
              text={cloud.importantMessage({
                bold: `<bold>${cloud.importantMessageBold()}</bold>`,
              })}
            />
          </InfoBanner>
        </View>
      )}

      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={cloud.continueButton()}
          disabled={isEncrypted ? !isValid : false}
          loading={busy}
          onPress={() => {
            if (isEncrypted) {
              onUpload({ password })
            } else {
              setShowPlaintextAck(true)
            }
          }}
          {...testProps("nostr-cloud-backup-continue")}
        />
        <GaloySecondaryButton
          title={LL.common.cancel()}
          onPress={onCancel}
          {...testProps("nostr-cloud-backup-cancel")}
        />
      </View>
      <Text type="p2" style={{ color: colors.grey2 }}>
        {T.cloudFootnote()}
      </Text>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: { padding: 24, rowGap: 16 },
  title: { color: colors.grey0 },
  body: { color: colors.grey1 },
  encryptionFields: { rowGap: 4, alignSelf: "stretch" },
  dangerCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DC2626",
    backgroundColor: colors.grey5,
    rowGap: 12,
  },
  dangerText: { color: colors.grey0 },
  actions: { marginTop: 8, rowGap: 12 },
}))
