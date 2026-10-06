import React, { useEffect, useState } from "react"
import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"
import { Text, makeStyles, useTheme } from "@rn-vui/themed"

import { Screen } from "@app/components/screen"
import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"

import { detailsTags, detailsText, type DetailField } from "@app/support-chat/details"
import { useAccountDetailFields } from "@app/support-chat/use-share-details"
import { useSupportChat } from "@app/support-chat/use-support-chat"

/**
 * "Share app & account details" (M19): every value is shown, each line can be
 * deselected, and the exact text that will be sent is previewed. Sending makes sure a
 * conversation exists (starting one if needed) and returns to the chat.
 */
export const SupportShareDetailsScreen: React.FC = () => {
  const { LL } = useI18nContext()
  const T = LL.SupportShareScreen
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { client } = useSupportChat()
  const { fields, loading } = useAccountDetailFields()
  const [off, setOff] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // a field that disappears (account switch) must not stay "off" for a new one
  useEffect(() => {
    setOff((prev) => new Set([...prev].filter((k) => fields.some((f) => f.key === k))))
  }, [fields])

  const selected: DetailField[] = fields.filter((f) => !off.has(f.key))
  const toggle = (key: string) =>
    setOff((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const send = async () => {
    if (!client || !selected.length) return
    setBusy(true)
    setError(null)
    try {
      await client.ensureConversation()
      await client.send(
        detailsText("account", selected),
        detailsTags("account", selected),
      )
      navigation.navigate("supportChat")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen preset="fixed">
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        testID="support-share-details-screen"
      >
        <Text style={styles.intro}>{T.detailsIntro()}</Text>
        {loading && <ActivityIndicator color={colors.primary} />}
        {fields.map((f) => {
          const on = !off.has(f.key)
          return (
            <Pressable
              key={f.key}
              style={styles.row}
              onPress={() => toggle(f.key)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              testID={`support-share-field-${f.key}`}
            >
              <View style={[styles.box, on && styles.boxOn]}>
                {on && <GaloyIcon name="check" size={14} color={colors.black} />}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.label}>{f.label}</Text>
                <Text style={styles.value} selectable>
                  {f.value}
                </Text>
              </View>
            </Pressable>
          )
        })}
        <Text style={styles.previewTitle}>{T.preview()}</Text>
        <Text style={styles.preview} testID="support-share-preview">
          {detailsText("account", selected)}
        </Text>
        <Text style={styles.never}>{T.never()}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.bottom}>
        <GaloyPrimaryButton
          title={busy ? T.sending() : T.send()}
          disabled={busy || !client || !selected.length}
          onPress={send}
          testID="support-share-send"
        />
      </View>
    </Screen>
  )
}

// blink-brand product surface: type 16/14/12, spacing 5 10 14 20, radii 8/16
export const useShareStyles = makeStyles(({ colors }) => ({
  flex: { flex: 1 },
  content: { padding: 20, gap: 10 },
  intro: { fontSize: 14, color: colors.grey2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey4,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.grey2,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  rowText: { flex: 1, gap: 3 },
  label: { fontSize: 12, color: colors.grey2 },
  value: { fontSize: 16, color: colors.grey0 },
  previewTitle: { fontSize: 12, color: colors.grey2, marginTop: 10 },
  preview: {
    fontSize: 14,
    color: colors.grey0,
    backgroundColor: colors.grey5,
    borderRadius: 16,
    padding: 14,
  },
  never: { fontSize: 12, color: colors.grey2 },
  error: { fontSize: 14, color: colors.error },
  bottom: { paddingHorizontal: 20, paddingVertical: 14 },
  listRow: { paddingHorizontal: 20 },
}))
const useStyles = useShareStyles
