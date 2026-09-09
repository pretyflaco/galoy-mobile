import React, { useEffect, useState } from "react"
import { ScrollView, TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { QrCodeComponent } from "@app/components/totp-export/totp-qr"
import { useClipboard } from "@app/hooks/use-clipboard"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  /** Loads the bech32 nsec for the active account's identity (null when unavailable). */
  loadNsec: () => Promise<string | null>
  /** Called ONLY when Done is tapped with the acknowledgement checked — marks backed up. */
  onDone: () => void
}

/** F6 fix (audit): the nsec is a non-rotatable secret — mirror the seed-phrase backup's
 *  clipboard hygiene and wipe it from the clipboard after 60s (and on unmount). */
const CLIPBOARD_CLEAR_MS = 60_000

const MASK = "•".repeat(24)

/**
 * Manual backup — reveal secret key (spec §7.9, Figma 23266:104493): QR of the nsec, a
 * masked secret field with copy, a two-way "Reveal key" toggle, and the mandatory
 * acknowledgement checkbox. The checkbox gates DONE (and therefore the backed-up state) —
 * NOT the exit: back is never blocked, and leaving via back leaves the identity
 * un-backed-up. Reveal and Copy are available immediately (not gated). The secret is
 * loaded on mount (the QR shows it even while the field is masked) but never logged or
 * persisted by this screen.
 */
export const NostrManualBackupScreen: React.FC<Props> = ({ loadNsec, onDone }) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrBackupScreen
  const { copyToClipboard } = useClipboard(CLIPBOARD_CLEAR_MS)
  const [revealed, setRevealed] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  // Tapping Done while unchecked highlights the checkbox row (spec §7.9).
  const [ackHighlight, setAckHighlight] = useState(false)
  // Deliberate secret display: this screen's sole purpose is showing the backup
  // value (the bech32 form of the identity secret). It never logs/persists it.
  const [secretBech32, setSecretBech32] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    loadNsec()
      .then((value) => {
        if (mounted) setSecretBech32(value)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [loadNsec])

  const onCopy = () => {
    if (!secretBech32) return
    copyToClipboard({ content: secretBech32, message: T.manualCopied() })
  }

  const onDonePress = () => {
    if (!acknowledged) {
      setAckHighlight(true)
      return
    }
    onDone()
  }

  return (
    <View style={styles.container} {...testProps("nostr-backup-manual-screen")}>
      {/* Hidden-state indicator (spec §7.9: top-right eye-off, NOT an active element). */}
      <View style={styles.hiddenIndicator} pointerEvents="none">
        <GaloyIcon
          name={revealed ? "eye" : "eye-slash"}
          size={20}
          color={styles.hiddenIcon.color}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {secretBech32 ? (
          <View style={styles.qrWrap} {...testProps("nostr-backup-qr")}>
            <QrCodeComponent value={secretBech32} />
          </View>
        ) : (
          <Text type="p2" style={styles.body}>
            {T.manualLoading()}
          </Text>
        )}

        {/* Secret field: masked by default; copy works in BOTH states. */}
        <Text type="p3" style={styles.fieldLabel}>
          {T.manualTitle()}
        </Text>
        <View style={styles.secretField} {...testProps("nostr-backup-secret")}>
          <Text type="p3" style={styles.secretText} numberOfLines={2}>
            {revealed ? secretBech32 ?? "" : MASK}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onCopy}
            {...testProps("nostr-backup-copy-icon")}
          >
            <GaloyIcon name="copy-paste" size={16} color={styles.icon.color} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.revealButton}
          accessibilityRole="button"
          accessibilityState={{ expanded: revealed }}
          onPress={() => setRevealed((v) => !v)}
          {...testProps("nostr-backup-reveal")}
        >
          <Text type="p3" bold style={styles.revealText}>
            {revealed ? T.manualHide() : T.manualReveal()}
          </Text>
          <GaloyIcon
            name={revealed ? "eye-slash" : "eye"}
            size={16}
            color={styles.revealText.color}
          />
        </TouchableOpacity>

        {/* Acknowledgement gates Done — never the exit (back is always available). */}
        <TouchableOpacity
          style={[
            styles.ackCard,
            ackHighlight && !acknowledged && styles.ackCardHighlight,
          ]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acknowledged }}
          onPress={() => {
            setAcknowledged((v) => !v)
            setAckHighlight(false)
          }}
          {...testProps("nostr-backup-acknowledge")}
        >
          <View style={[styles.checkbox, acknowledged && styles.checkboxChecked]}>
            {acknowledged ? (
              <GaloyIcon name="check" size={13} weight="bold" color="#000000" />
            ) : null}
          </View>
          <Text type="p3" style={styles.ackText}>
            {T.manualAcknowledge()}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={T.manualCopy()}
          onPress={onCopy}
          disabled={!secretBech32}
          {...testProps("nostr-backup-copy-nsec")}
        />
        {/* Not `disabled` — a disabled button can't report the tap that should highlight
            the checkbox; the press is handled manually and the style signals the state. */}
        <GaloySecondaryButton
          title={T.manualDone()}
          onPress={onDonePress}
          containerStyle={!acknowledged && styles.doneDisabled}
          {...testProps("nostr-backup-manual-done")}
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
  hiddenIndicator: {
    position: "absolute",
    top: 12,
    right: 20,
    zIndex: 1,
  },
  hiddenIcon: {
    color: colors.grey3,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    rowGap: 14,
  },
  qrWrap: {
    alignSelf: "center",
    backgroundColor: colors._white,
    borderRadius: 14,
    padding: 20,
  },
  body: {
    color: colors.grey1,
    textAlign: "center",
  },
  fieldLabel: {
    color: colors.grey0,
  },
  secretField: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    backgroundColor: colors.grey5,
    borderRadius: 8,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 10,
  },
  secretText: {
    flex: 1,
    color: colors.grey3,
    fontFamily: "monospace",
  },
  icon: {
    color: colors.grey0,
  },
  revealButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 8,
    backgroundColor: colors.grey5,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  revealText: {
    color: colors.primary,
  },
  ackCard: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 14,
    backgroundColor: colors.grey5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.transparent,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  ackCardHighlight: {
    borderColor: colors.primary,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.grey3,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  ackText: {
    flex: 1,
    color: colors.grey0,
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    rowGap: 10,
  },
  doneDisabled: {
    opacity: 0.35,
  },
}))
