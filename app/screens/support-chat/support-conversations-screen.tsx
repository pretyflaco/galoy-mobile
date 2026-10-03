import React, { useState } from "react"
import { useNavigation } from "@react-navigation/native"
import { FlatList, Pressable, View } from "react-native"
import { Text, makeStyles, useTheme } from "@rn-vui/themed"

import { Screen } from "@app/components/screen"
import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { useI18nContext } from "@app/i18n/i18n-react"

import { useSupportChat } from "@app/support-chat/use-support-chat"
import type { Conversation } from "@app/support-chat/client"

/**
 * Support conversations (M19, Andrej's redesign): every conversation on this device,
 * newest first — its title (the user's first message), its date, and a green check on
 * the current one. Tap: open it (the current one writable, older ones read-only).
 * "Start new" ends the current conversation and starts a fresh one (Option C).
 */
export const SupportConversationsScreen: React.FC = () => {
  const { LL } = useI18nContext()
  const T = LL.SupportConversationsScreen
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const navigation = useNavigation()
  const { client } = useSupportChat()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = client?.conversations() ?? []
  const isCurrent = (c: Conversation) =>
    c.gid === client?.groupId && c.status === "active"

  const open = (c: Conversation) => {
    if (!client) return
    client.view(c.gid === client.groupId ? null : c.gid)
    navigation.goBack()
  }

  const startNew = async () => {
    if (!client) return
    setBusy(true)
    setError(null)
    try {
      if (client.groupId) await client.startNew()
      else await client.start()
      navigation.goBack()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen preset="fixed">
      <View style={styles.root} testID="support-conversations-screen">
        <FlatList
          data={list}
          keyExtractor={(c) => c.gid}
          renderItem={({ item: c }) => (
            <Pressable
              style={styles.row}
              onPress={() => open(c)}
              accessibilityRole="button"
              testID="support-conversation-row"
            >
              <View style={styles.check}>
                {isCurrent(c) && (
                  <View
                    style={styles.checkDot}
                    accessibilityLabel={T.current()}
                    testID="support-conversation-current"
                  >
                    <GaloyIcon name="check" size={12} color={colors.white} />
                  </View>
                )}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.title} numberOfLines={1}>
                  {c.title || T.untitled()}
                </Text>
                <Text style={styles.date}>
                  {new Date(c.startedAt * 1000).toLocaleDateString()}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>{T.empty()}</Text>}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.bottom}>
          <GaloyPrimaryButton
            title={busy ? T.starting() : T.startNew()}
            disabled={busy || !client || client.status !== "ready"}
            onPress={startNew}
            testID="support-conversations-start-new"
          />
        </View>
      </View>
    </Screen>
  )
}

// blink-brand product surface: type 16/12, spacing 5 10 14 20, radii 999
const useStyles = makeStyles(({ colors }) => ({
  root: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey4,
  },
  check: { width: 30, alignItems: "flex-start" },
  checkDot: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: colors._green,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 3 },
  title: { fontSize: 16, color: colors.grey0 },
  date: { fontSize: 12, color: colors.grey2 },
  empty: { fontSize: 16, color: colors.grey2, textAlign: "center", padding: 30 },
  error: { fontSize: 14, color: colors.error, paddingHorizontal: 20, paddingTop: 5 },
  bottom: { paddingHorizontal: 20, paddingVertical: 14 },
}))
