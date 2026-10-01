import React, { useState } from "react"
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native"
import { Text, makeStyles, useTheme } from "@rn-vui/themed"

import { Screen } from "@app/components/screen"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { useI18nContext } from "@app/i18n/i18n-react"

import { useSupportChat } from "@app/support-chat/use-support-chat"
import type { ChatItem, EndReason, MemberLabel } from "@app/support-chat/client"

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

  const [showPrevious, setShowPrevious] = useState(false)

  const T = LL.SupportChatScreen
  const unverified = client?.unverifiedMembers() ?? []
  const sendingBlocked = unverified.length > 0
  const handoff = client?.handoffState() ?? "bot"
  // Option C: conversations are sessions — an ended one is readable, never a dead end
  const current = client?.current() ?? null
  const ended = current?.status === "ended"
  const viewingPast = Boolean(client?.viewing)
  const previous = (client?.conversations() ?? []).filter(
    (c) => c.gid !== client?.groupId,
  )
  const endedText: Record<EndReason, () => string> = {
    user: T.endedUser,
    replaced: T.endedReplaced,
    stuck: T.endedStuck,
    removed: T.endedRemoved,
    unrestorable: T.endedUnrestorable,
  }

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

  const send = () => {
    if (!client || !draft.trim()) return
    const text = draft
    setDraft("")
    run(async () => {
      await client.send(text)
    })
  }

  const renderItem = ({ item }: { item: ChatItem }) => {
    if (item.type === "notice")
      return (
        <Text style={styles.notice} testID="support-chat-notice">
          » {item.text}
        </Text>
      )
    if (item.type === "warning")
      return (
        <Text
          style={[styles.notice, { color: colors.error }]}
          testID="support-chat-warning"
        >
          ⚠ {item.text}
        </Text>
      )
    const who: MemberLabel | null =
      item.mine || !client || !item.from ? null : client.label(item.from)
    return (
      <View
        style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}
        testID="support-chat-message"
      >
        {who && (
          <Text
            style={[
              styles.sender,
              { color: who.verified ? colors._green ?? colors.primary : colors.error },
            ]}
          >
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
      <View style={styles.root} testID="support-chat-screen">
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
          style={[
            styles.handoff,
            {
              color: handoff === "agent" ? colors._green ?? colors.primary : colors.grey2,
            },
          ]}
          testID="support-chat-handoff"
        >
          {handoff === "agent" ? T.handoffAgent() : T.handoffBot()}
        </Text>

        {(error || actionError) && (
          <Text
            style={[styles.error, { color: colors.error }]}
            testID="support-chat-error"
          >
            {error ?? actionError}
          </Text>
        )}

        {sendingBlocked && (
          <Text
            style={[styles.blocked, { color: colors.error }]}
            testID="support-chat-unverified"
          >
            ⚠{" "}
            {T.unverifiedBlocked({ members: unverified.map((m) => m.text).join("; ") })}
          </Text>
        )}

        {client && client.status === "starting" && (
          <ActivityIndicator size="small" color={colors.primary} />
        )}

        {client && !client.groupId && client.status !== "starting" && (
          <GaloyPrimaryButton
            title={busy ? T.starting() : T.start()}
            disabled={busy || client.status !== "ready"}
            onPress={() => run(() => client.start())}
            testID="support-chat-start"
          />
        )}

        {client && viewingPast && (
          <View style={styles.banner}>
            <Text style={styles.bannerText} testID="support-chat-viewing-past">
              {T.viewingPast()}
            </Text>
            <Pressable onPress={() => client.view(null)} testID="support-chat-back">
              <Text style={[styles.link, { color: colors.primary }]}>
                {T.backToCurrent()}
              </Text>
            </Pressable>
          </View>
        )}

        {client && current && ended && !viewingPast && (
          <View style={styles.banner}>
            <Text style={styles.bannerText} testID="support-chat-ended">
              {endedText[current.reason ?? "user"]()}
            </Text>
            <GaloyPrimaryButton
              title={busy ? T.starting() : T.startNew()}
              disabled={busy || client.status !== "ready"}
              onPress={() => run(() => client.startNew())}
              testID="support-chat-start-new"
            />
          </View>
        )}

        {client && current && !ended && !viewingPast && (
          <Pressable
            disabled={busy || client.status !== "ready"}
            onPress={() => run(() => client.startNew())}
            testID="support-chat-new-conversation"
          >
            <Text style={[styles.link, { color: colors.primary }]}>
              {T.newConversation()}
            </Text>
          </Pressable>
        )}

        {client && previous.length > 0 && !viewingPast && (
          <View>
            <Pressable
              onPress={() => setShowPrevious(!showPrevious)}
              testID="support-chat-previous-toggle"
            >
              <Text style={[styles.link, { color: colors.primary }]}>
                {showPrevious
                  ? T.hidePrevious()
                  : T.previousConversations({ count: previous.length })}
              </Text>
            </Pressable>
            {showPrevious &&
              previous.map((c) => (
                <Pressable
                  key={c.gid}
                  onPress={() => client.view(c.gid)}
                  testID="support-chat-previous-item"
                >
                  <Text style={styles.previousItem}>
                    {T.conversationItem({
                      date: new Date(c.startedAt * 1000).toLocaleString(),
                      status: c.status === "ended" ? T.statusEnded() : T.statusActive(),
                    })}
                  </Text>
                </Pressable>
              ))}
          </View>
        )}

        <FlatList
          style={styles.list}
          // inverted list: newest first, so the latest message sits at the bottom
          // above the composer (F-M16-9: it was rendering chronological data upside down)
          data={
            client ? [...(viewingPast ? client.viewItems : client.items)].reverse() : []
          }
          inverted
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.empty}>{T.empty()}</Text>}
        />

        {client?.groupId && !ended && !viewingPast && (
          <View style={styles.composer}>
            <TextInput
              style={[styles.input, { borderColor: colors.grey3, color: colors.black }]}
              placeholder={
                sendingBlocked ? T.composerBlockedPlaceholder() : T.composerPlaceholder()
              }
              placeholderTextColor={colors.grey3}
              value={draft}
              onChangeText={setDraft}
              editable={!sendingBlocked}
              testID="support-chat-input"
            />
            <Pressable
              disabled={busy || sendingBlocked || !draft.trim()}
              onPress={send}
              style={[
                styles.send,
                { backgroundColor: colors.primary },
                (busy || sendingBlocked || !draft.trim()) && styles.sendDisabled,
              ]}
              testID="support-chat-send"
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
  notice: {
    textAlign: "center",
    fontStyle: "italic",
    fontSize: 12,
    marginVertical: 4,
    color: colors.grey2,
  },
  bubble: { maxWidth: "85%", marginVertical: 4, padding: 8, borderRadius: 8 },
  mine: { alignSelf: "flex-end", backgroundColor: colors.grey4 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.grey5 },
  sender: { fontSize: 11, fontWeight: "bold" },
  composer: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, padding: 8 },
  send: { padding: 10, borderRadius: 8 },
  sendDisabled: { opacity: 0.5 },
  banner: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.grey5,
    gap: 8,
  },
  bannerText: { fontSize: 13 },
  link: { fontSize: 12, marginTop: 6, textDecorationLine: "underline" },
  previousItem: { fontSize: 12, marginVertical: 3, color: colors.grey2 },
}))
