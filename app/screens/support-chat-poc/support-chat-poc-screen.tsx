/**
 * Support chat — P1 scaffolding screen (from poc/support-chat-demo M6, adapted to the
 * v2 client). Deliberately minimal (no polish, English only, no i18n keys): roster
 * status, members with roster labels (UNVERIFIED in red), the message list with
 * warnings, a text box. P2 replaces this with the real conversation UX.
 */
import React, { useState } from "react"
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native"
import { Text, useTheme } from "@rn-vui/themed"

import { Screen } from "@app/components/screen"
import { useSupportChat } from "@app/support-chat/use-support-chat"
import { SUPPORT_ROSTER_PUBKEY } from "@app/support-chat/roster-config"
import type { ChatItem, MemberLabel } from "@app/support-chat/client"

const startLabel = (status: string, busy: boolean) => {
  if (status !== "ready") return "Connecting…"
  return busy ? "Starting…" : "Start a support chat"
}

export const SupportChatPocScreen: React.FC = () => {
  const {
    theme: { colors },
  } = useTheme()
  const { client, error } = useSupportChat()
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
    } catch (e) {
      console.log(
        "[support-chat] action failed:",
        e instanceof Error ? e.stack : String(e),
      )
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const red = { color: colors.error }
  const green = { color: colors._green ?? colors.primary }

  const renderItem = ({ item }: { item: ChatItem }) => {
    if (item.type !== "msg")
      return (
        <Text
          style={[styles.notice, item.type === "warning" ? red : { color: colors.grey2 }]}
        >
          {item.type === "warning" ? "⚠ " : "» "}
          {item.text}
        </Text>
      )
    const who: MemberLabel | null =
      item.mine || !client || !item.from ? null : client.label(item.from)
    return (
      <View
        style={[
          styles.bubble,
          item.mine ? styles.mine : styles.theirs,
          { backgroundColor: item.mine ? colors.grey4 : colors.grey5 },
        ]}
      >
        {who && (
          <Text style={[styles.sender, who.verified ? green : red]}>
            {who.verified ? "✓ " : "⚠ "}
            {who.text}
          </Text>
        )}
        <Text>{item.text}</Text>
      </View>
    )
  }

  return (
    <Screen preset="fixed" keyboardShouldPersistTaps="handled">
      <View style={styles.root}>
        <Text style={[styles.small, { color: colors.grey2 }]}>
          E2EE (Marmot v2/MLS) · roster {SUPPORT_ROSTER_PUBKEY.slice(0, 8)} (pinned):{" "}
          {client?.rosterStatus() ?? "…"} · you {client?.pubkey.slice(0, 8) ?? "…"}
        </Text>
        {(error || actionError) && (
          <Text style={[styles.error, red]}>{error ?? actionError}</Text>
        )}
        {client?.members().map((m) => (
          <Text key={m.pubkey} style={[styles.member, m.verified ? green : red]}>
            {m.verified ? "✓ " : "⚠ "}
            {m.text}
          </Text>
        ))}
        {client && !client.groupId && (
          <Pressable
            disabled={busy || client.status !== "ready"}
            onPress={() => run(() => client.start())}
            style={[styles.start, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.center, { color: colors.white }]}>
              {startLabel(client.status, busy)}
            </Text>
          </Pressable>
        )}
        <FlatList
          style={styles.list}
          data={client ? [...client.items].reverse() : []}
          inverted
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
        />
        {client?.groupId && (
          <View style={styles.composer}>
            <TextInput
              style={[styles.input, { borderColor: colors.grey3, color: colors.black }]}
              placeholder="Message"
              placeholderTextColor={colors.grey3}
              value={draft}
              onChangeText={setDraft}
            />
            <Pressable
              disabled={busy || !draft.trim()}
              onPress={() =>
                run(async () => {
                  const text = draft
                  setDraft("")
                  await client.send(text)
                })
              }
              style={[styles.send, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.white }}>Send</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12 },
  small: { fontSize: 11 },
  error: { marginTop: 4 },
  member: { fontWeight: "bold", marginTop: 2 },
  start: { marginTop: 16, padding: 12, borderRadius: 8 },
  center: { textAlign: "center" },
  list: { flex: 1, marginTop: 8 },
  notice: { textAlign: "center", fontStyle: "italic", fontSize: 12, marginVertical: 4 },
  bubble: { maxWidth: "85%", marginVertical: 4, padding: 8, borderRadius: 8 },
  mine: { alignSelf: "flex-end" },
  theirs: { alignSelf: "flex-start" },
  sender: { fontSize: 11, fontWeight: "bold" },
  composer: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 8 },
  send: { padding: 10, borderRadius: 8 },
})
