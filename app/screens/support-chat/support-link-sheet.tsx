import React, { useEffect, useState } from "react"
import { TouchableOpacity, View } from "react-native"
import ReactNativeModal from "react-native-modal"
import Clipboard from "@react-native-clipboard/clipboard"
import { Text, makeStyles } from "@rn-vui/themed"

import { useI18nContext } from "@app/i18n/i18n-react"
import { openExternalUrl } from "@app/utils/external"

/**
 * Hermes R10-S10 (operator 2026-10-06: a sheet for EVERY web link): before a link from support
 * opens, the customer sees the full address with its domain highlighted and chooses Open,
 * Copy link or Cancel — no label can hide where a link leads. App links (fixed screens,
 * labels from the app) do not use this.
 */
export const SupportLinkSheet: React.FC<{ url: string | null; onClose: () => void }> = ({
  url,
  onClose,
}) => {
  const styles = useStyles()
  const { LL } = useI18nContext()
  const T = LL.SupportChatScreen
  const [copied, setCopied] = useState(false)
  useEffect(() => setCopied(false), [url])

  let host = ""
  let before = url ?? ""
  let after = ""
  if (url) {
    try {
      host = new URL(url).host
      const i = url.indexOf(host)
      before = url.slice(0, i)
      after = url.slice(i + host.length)
    } catch {
      host = ""
    }
  }

  return (
    <ReactNativeModal
      isVisible={Boolean(url)}
      onBackdropPress={onClose}
      onBackButtonPress={onClose}
      style={styles.modal}
    >
      <View style={styles.sheet} testID="support-chat-link-sheet">
        <Text style={styles.title}>{T.linkSheetTitle()}</Text>
        {host ? (
          <Text style={styles.domain} testID="support-chat-link-sheet-domain">
            {host}
          </Text>
        ) : null}
        <Text style={styles.url} selectable testID="support-chat-link-sheet-url">
          {before}
          <Text style={styles.urlHost}>{host}</Text>
          {after}
        </Text>
        <Text style={styles.hint}>{T.linkSheetHint()}</Text>
        <TouchableOpacity
          style={styles.primary}
          accessibilityRole="button"
          testID="support-chat-link-open"
          onPress={() => {
            const target = url
            onClose()
            if (target) openExternalUrl(target)
          }}
        >
          <Text style={styles.primaryText}>{T.linkSheetOpen()}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondary}
          accessibilityRole="button"
          testID="support-chat-link-copy"
          onPress={() => {
            if (url) Clipboard.setString(url)
            setCopied(true)
          }}
        >
          <Text style={styles.secondaryText}>
            {copied ? T.linkSheetCopied() : T.linkSheetCopy()}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondary}
          accessibilityRole="button"
          testID="support-chat-link-cancel"
          onPress={onClose}
        >
          <Text style={styles.secondaryText}>{T.linkSheetCancel()}</Text>
        </TouchableOpacity>
      </View>
    </ReactNativeModal>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  modal: { justifyContent: "flex-end", margin: 0 },
  sheet: {
    backgroundColor: colors.grey5,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: "600", color: colors.black },
  domain: { fontSize: 20, fontWeight: "700", color: colors.black },
  url: { fontSize: 14, color: colors.grey1 },
  urlHost: { fontWeight: "700", color: colors.black },
  hint: { fontSize: 13, color: colors.grey2 },
  primary: {
    marginTop: 6,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { fontSize: 16, fontWeight: "600", color: "#000000" },
  secondary: { paddingVertical: 12, alignItems: "center" },
  secondaryText: { fontSize: 16, color: colors.primary },
}))
