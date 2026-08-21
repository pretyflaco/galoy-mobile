import React, { useEffect, useState } from "react"
import { ScrollView, TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { QrCodeComponent } from "@app/components/totp-export/totp-qr"
import { useClipboard } from "@app/hooks/use-clipboard"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  /** Loads the bech32 nsec for the active account's identity (null when unavailable). */
  loadNsec: () => Promise<string | null>
  onDone: () => void
}

/** F6 fix (audit): the nsec is a non-rotatable secret — mirror the seed-phrase backup's
 *  clipboard hygiene and wipe it from the clipboard after 60s (and on unmount). */
const CLIPBOARD_CLEAR_MS = 60_000

/**
 * Nostr manual backup (2026-08-21): the bech32 nsec behind a tap-to-reveal, with copy + QR
 * (scannable by the app's own import flow). The secret is loaded only after the user reveals.
 */
export const NostrManualBackupScreen: React.FC<Props> = ({ loadNsec, onDone }) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrBackupScreen
  const { copyToClipboard } = useClipboard(CLIPBOARD_CLEAR_MS)
  const [revealed, setRevealed] = useState(false)
  // Deliberate secret display: this screen's sole purpose is showing the backup
  // value (the bech32 form of the identity secret). It never logs/persists it.
  const [secretBech32, setSecretBech32] = useState<string | null>(null)

  useEffect(() => {
    if (!revealed || secretBech32) return
    let mounted = true
    loadNsec()
      .then((value) => {
        if (mounted) setSecretBech32(value)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [revealed, secretBech32, loadNsec])

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text type="h1" style={styles.title}>
        {T.manualTitle()}
      </Text>
      <Text type="p1" style={styles.body}>
        {T.manualBody()}
      </Text>

      {revealed ? (
        <View style={styles.secretCard} {...testProps("nostr-backup-secret")}>
          {secretBech32 ? (
            <>
              <Text type="p2" style={styles.secret} selectable>
                {secretBech32}
              </Text>
              <View style={styles.qr}>
                <QrCodeComponent value={secretBech32} />
              </View>
            </>
          ) : (
            <Text type="p2" style={styles.body}>
              {T.manualLoading()}
            </Text>
          )}
        </View>
      ) : (
        <TouchableOpacity
          style={styles.revealCard}
          accessibilityRole="button"
          onPress={() => setRevealed(true)}
          {...testProps("nostr-backup-reveal")}
        >
          <Text type="p1" style={styles.revealText}>
            {T.manualReveal()}
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.actions}>
        {revealed && secretBech32 ? (
          <GaloyPrimaryButton
            title={T.manualCopy()}
            onPress={() =>
              copyToClipboard({ content: secretBech32, message: T.manualCopied() })
            }
            {...testProps("nostr-backup-copy-nsec")}
          />
        ) : null}
        <GaloySecondaryButton
          title={T.manualDone()}
          onPress={onDone}
          {...testProps("nostr-backup-manual-done")}
        />
      </View>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: { padding: 24, rowGap: 16 },
  title: { color: colors.grey0 },
  body: { color: colors.grey1 },
  revealCard: {
    padding: 24,
    borderRadius: 12,
    backgroundColor: colors.grey5,
    alignItems: "center",
  },
  revealText: { color: colors.primary, fontWeight: "600" },
  secretCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.grey5,
    rowGap: 12,
  },
  secret: { color: colors.grey0, fontFamily: "monospace" },
  qr: { alignItems: "center" },
  actions: { marginTop: 8, rowGap: 12 },
}))
