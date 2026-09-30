import React, { useState } from "react"
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native"
import { Text, makeStyles, useTheme } from "@rn-vui/themed"

import { Screen } from "@app/components/screen"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

import { useSupportChat } from "@app/support-chat/use-support-chat"
import type { ChatItem, MemberLabel } from "@app/support-chat/client"

/**
 * The support-chat conversation screen (P2): roster-labelled messages, membership
 * notices, handoff states (req 12), and the two policy defaults from spec 03 §5 —
 * an unverified member warns AND blocks sending, and revocation relabels history
 * as-of-now with a roster-change warning. Statuses from the client (starting /
 * reconnecting / degraded, incl. the F-M12-2 auto-recovery) surface in the header.
 */
export const SupportChatScreen: React.FC = () => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const { client, error } = useSupportChat()
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const T = LL.SupportChatScreen
  const unverified = client?.unverifiedMembers() ?? []
  const sendingBlocked = unverified.length > 0
  const handoff = client?.handoffState() ?? "bot"

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
    } catch (e) {
      console.log("[support-chat] action failed:", e instanceof Error ? e.stack : String(e))
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const send = () => {
    if (!client || !draft.trim()) return
    const text = draft
    setDraft("")
    void run(async () => {
      await client.send(text)
    })
  }

  const renderItem = ({ item }: { item: ChatItem }) => {
    if (item.type === "notice")
      return (
        <Text style={styles.notice} {...testProps("support-chat-notice")}>
          » {item.text}
        </Text>
      )
    if (item.type === "warning")
      return (
        <Text style={[styles.notice, { color: colors.error }]} {...testProps("support-chat-warning")}>
          ⚠ {item.text}
        </Text>
      )
    const who: MemberLabel | null =
      item.mine || !client || !item.from ? null : client.label(item.from)
    return (
      <View
        style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}
        {...testProps("support-chat-message")}
      >
        {who && (
          <Text style={[styles.sender, { color: who.verified ? colors._green ?? colors.primary : colors.error }]}>
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
      <View style={styles.root} {...testProps("support-chat-screen")}>
        <Text style={styles.status}>
          {client
            ? client.status === "reconnecting"
              ? T.statusReconnecting()
              : client.status === "degraded"
                ? T.statusDegraded()
                : `${T.statusReady()} · ${client.rosterStatus()}`
            : T.statusStarting()}
        </Text>

        <Text
          style={[styles.handoff, { color: handoff === "agent" ? colors._green ?? colors.primary : colors.grey2 }]}
          {...testProps("support-chat-handoff")}
        >
          {handoff === "agent" ? T.handoffAgent() : T.handoffBot()}
        </Text>

        {(error || actionError) && (
          <Text style={[styles.error, { color: colors.error }]} {...testProps("support-chat-error")}>
            {error ?? actionError}
          </Text>
        )}

        {sendingBlocked && (
          <Text style={[styles.blocked, { color: colors.error }]} {...testProps("support-chat-unverified")}>
            ⚠ {T.unverifiedBlocked({ members: unverified.map((m) => m.text).join("; ") })}
          </Text>
        )}

        {client && client.status === "starting" && (
          <ActivityIndicator size="small" color={colors.primary} />
        )}

        {client && !client.groupId && client.status !== "starting" && (
          <GaloyPrimaryButton
            title={busy ? T.starting() : T.start()}
            disabled={busy || client.status !== "ready"}
            onPress={() => void run(() => client.start())}
            {...testProps("support-chat-start")}
          />
        )}

        <FlatList
          style={styles.list}
          data={client ? client.items : []}
          inverted
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.empty}>{T.empty()}</Text>}
        />

        {client?.groupId && (
          <View style={styles.composer}>
            <TextInput
              style={[styles.input, { borderColor: colors.grey3, color: colors.black }]}
              placeholder={sendingBlocked ? T.composerBlockedPlaceholder() : T.composerPlaceholder()}
              placeholderTextColor={colors.grey3}
              value={draft}
              onChangeText={setDraft}
              editable={!sendingBlocked}
              {...testProps("support-chat-input")}
            />
            <Pressable
              disabled={busy || sendingBlocked || !draft.trim()}
              onPress={send}
              style={[styles.send, { backgroundColor: colors.primary }, (busy || sendingBlocked || !draft.trim()) && { opacity: 0.5 }]}
              {...testProps("support-chat-send")}
            >
              <Text style={{ color: colors.white }}>{T.send()}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Screen>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  root: { flex: 1, padding: 12 },
  status: { fontSize: 11, color: colors.grey2 },
  handoff: { fontSize: 12, fontWeight: "bold", marginTop: 4 },
  error: { marginTop: 4, fontSize: 12 },
  blocked: { marginTop: 8, fontSize: 12, fontWeight: "bold" },
  list: { flex: 1, marginTop: 8 },
  empty: { textAlign: "center", color: colors.grey2, marginTop: 32 },
  notice: { textAlign: "center", fontStyle: "italic", fontSize: 12, marginVertical: 4, color: colors.grey2 },
  bubble: { maxWidth: "85%", marginVertical: 4, padding: 8, borderRadius: 8 },
  mine: { alignSelf: "flex-end", backgroundColor: colors.grey4 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.grey5 },
  sender: { fontSize: 11, fontWeight: "bold" },
  composer: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 8 },
  send: { padding: 10, borderRadius: 8 },
}))
