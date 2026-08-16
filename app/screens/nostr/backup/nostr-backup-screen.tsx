import React, { useState } from "react"
import { ScrollView, View } from "react-native"

import { Input, Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  /** Encrypt-and-back-up with the entered password (default path). */
  onEncryptedBackup: (password: string) => void
  /** Proceed with an UNENCRYPTED backup only after explicit acknowledgment. */
  onPlaintextAcknowledged: () => void
  /** Decline backup — must never block anything (FR-8). */
  onNotNow: () => void
}

/**
 * nsec backup entry (Story 1.7). Encrypted-by-default: the primary path sets a backup
 * password. Choosing "back up without a password" surfaces a {consent-danger} plaintext
 * acknowledgment whose destructive control is off the default focus. "Not now" never blocks.
 */
export const NostrBackupScreen: React.FC<Props> = ({
  onEncryptedBackup,
  onPlaintextAcknowledged,
  onNotNow,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrBackupScreen
  const [password, setPassword] = useState("")
  const [showPlaintextAck, setShowPlaintextAck] = useState(false)

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
            onPress={onPlaintextAcknowledged}
            {...testProps("nostr-backup-plaintext-confirm")}
          />
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text type="h1" style={styles.title}>
        {T.title()}
      </Text>
      <Text type="p1" style={styles.body}>
        {T.passwordPrompt()}
      </Text>

      <Input
        label={T.passwordLabel()}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={password}
        onChangeText={setPassword}
        {...testProps("nostr-backup-password")}
      />

      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={T.passwordCta()}
          disabled={password.length === 0}
          onPress={() => onEncryptedBackup(password)}
          {...testProps("nostr-backup-encrypt")}
        />
        <GaloySecondaryButton
          title={T.plaintextConfirm()}
          onPress={() => setShowPlaintextAck(true)}
          {...testProps("nostr-backup-without-password")}
        />
        <GaloySecondaryButton
          title={T.notNow()}
          onPress={onNotNow}
          {...testProps("nostr-backup-not-now")}
        />
      </View>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: { padding: 24, rowGap: 16 },
  title: { color: colors.grey0 },
  body: { color: colors.grey1 },
  actions: { marginTop: 24, rowGap: 12 },
  dangerCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#DC2626", // {consent-danger} on border/accent ONLY
    backgroundColor: colors.grey5,
    rowGap: 12,
  },
  dangerText: { color: colors.grey0 }, // consequence copy never danger red
}))
