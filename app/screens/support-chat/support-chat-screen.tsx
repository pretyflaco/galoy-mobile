import React, { useCallback, useEffect, useState } from "react"
import { useFocusEffect, useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Text, makeStyles, useTheme } from "@rn-vui/themed"

import { Screen } from "@app/components/screen"
import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { headerRightNoGlass, noHeaderRight } from "@app/components/header-no-glass"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"

import { useSupportChat } from "@app/support-chat/use-support-chat"
import { PUSH_SERVER_PUBKEY, askPermission } from "@app/support-chat/push"
import type { ChatItem, EndReason, MemberLabel } from "@app/support-chat/client"

/** Brand black — the label colour on the primary fill (blink-brand: white on primary fails contrast). */
const ON_PRIMARY = "#000000"

/** The relay sends human replies under the bot's key, prefixed "Support (<name>): ". */
const RELAYED = /^Support \(([^)]+)\):\s*/
const relayedAuthor = (text: string): { name: string | null; body: string } => {
  const m = RELAYED.exec(text)
  return m ? { name: m[1], body: text.slice(m[0].length) } : { name: null, body: text }
}

/** A pause longer than this starts a new run (its own time label), like messengers do. */
const RUN_GAP_S = 5 * 60
const dayOf = (at: number) => new Date(at * 1000).toDateString()
const timeOf = (at: number) =>
  new Date(at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

type Row = {
  item: ChatItem
  author: string | null // shown above the first bubble of a run
  verified: boolean
  body: string
  firstOfRun: boolean
  lastOfRun: boolean
  day: string | null // a day separator above this row
}

/** Old history items carry lowercase "joined:" / "left:" notices (before M19). */
const capitalized = (text: string) =>
  text.replace(/^(joined|left):/, (m) => m.charAt(0).toUpperCase() + m.slice(1))

/**
 * The support-chat conversation screen: a messenger layout (blink-brand product rules —
 * Source Sans Pro scale 16/14/12, spacing tokens, radii 16 and pill) over the client:
 * roster-labelled messages (each author label says who answers — req 12), membership
 * notices, unverified members warn AND block sending (spec 03 §5), Option C sessions,
 * client statuses (starting / reconnecting / degraded).
 * M19 (Andrej's redesign): no top bar; the header's clock opens the Conversations screen
 * (list, titles, "Start new"), which replaced the ⋯ menu.
 */
export const SupportChatScreen: React.FC = () => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const { client, error } = useSupportChat()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  // Android draws edge-to-edge, so adjustResize no longer lifts the content, and
  // KeyboardAvoidingView misjudged the overlap there (it left the composer under the
  // keyboard on the A56). The IME inset is exact: lift by it, minus the bottom inset the
  // Screen already pads. iOS: the Screen's own KeyboardAvoidingView handles it.
  const keyboard = useAnimatedKeyboard()
  const { bottom: bottomInset } = useSafeAreaInsets()
  const liftForKeyboard = Platform.OS === "android"
  const keyboardLift = useAnimatedStyle(
    () => ({
      paddingBottom: liftForKeyboard
        ? Math.max(0, keyboard.height.value - bottomInset)
        : 0,
    }),
    [bottomInset, liftForKeyboard], // explicit deps: also valid without the worklets plugin (jest)
  )

  // unread: nothing counts while this screen is in front
  useFocusEffect(
    useCallback(() => {
      client?.setScreenFocused(true)
      return () => client?.setScreenFocused(false)
    }, [client]),
  )

  // M18: ask for notification permission here, where the user sees why; then announce
  // the push token in the conversation (no-op unless the build configures push).
  const status = client?.status
  useEffect(() => {
    if (!PUSH_SERVER_PUBKEY || status !== "ready" || !client) return
    askPermission()
      .then((granted) => (granted ? client.announcePush() : undefined))
      .catch(() => undefined)
  }, [client, status])

  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const T = LL.SupportChatScreen
  const unverified = client?.unverifiedMembers() ?? []
  const sendingBlocked = unverified.length > 0
  // Option C: conversations are sessions — an ended one is readable, never a dead end
  const current = client?.current() ?? null
  const ended = current?.status === "ended"
  const viewingPast = Boolean(client?.viewing)
  const hasConversations = (client?.conversations().length ?? 0) > 0
  const endedText: Record<EndReason, () => string> = {
    user: T.endedUser,
    replaced: T.endedReplaced,
    stuck: T.endedStuck,
    removed: T.endedRemoved,
    unrestorable: T.endedUnrestorable,
    identity: T.endedIdentity,
  }

  // the clock in the header opens the Conversations screen (once there is one)
  useEffect(() => {
    navigation.setOptions(
      hasConversations
        ? headerRightNoGlass(() => (
            <TouchableOpacity
              onPress={() => navigation.navigate("supportChatConversations")}
              accessibilityRole="button"
              accessibilityLabel={T.conversations()}
              testID="support-chat-conversations"
            >
              <GaloyIcon name="clock" size={22} />
            </TouchableOpacity>
          ))
        : noHeaderRight,
    )
  }, [navigation, hasConversations, T])
  const canWrite = Boolean(client?.groupId) && !ended && !viewingPast
  const sendDisabled = busy || sendingBlocked || !draft.trim()

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

  // chronological rows with run/day metadata, reversed for the inverted list (newest at
  // the bottom, above the composer — F-M16-9)
  const items = client ? (viewingPast ? client.viewItems : client.items) : []
  // (not memoized: ≤500 items, and the client replaces its item array on every change)
  const rows: Row[] = (() => {
    // pass 1: who wrote each message (a run = consecutive messages, same author, same day)
    const meta = items.map((item) => {
      let author: string | null = null
      let verified = true
      let body = item.text
      if (item.type === "msg" && !item.mine && client && item.from) {
        const who: MemberLabel = client.label(item.from)
        const relayed = relayedAuthor(item.text)
        body = relayed.body
        verified = who.verified
        if (relayed.name === null) author = who.text
        else if (relayed.name === "Blink assistant") author = T.assistantName()
        else author = T.agentLabel({ name: relayed.name })
      }
      let key: string | null = null
      if (item.type === "msg") key = item.mine ? "me" : `${item.from}|${author}`
      return { item, author, verified, body, key, day: dayOf(item.at) }
    })
    // pass 2: run boundaries (same author, same day, ≤ 5 min apart) and day separators
    const joins = (a: (typeof meta)[number], b: (typeof meta)[number]) =>
      Boolean(a.key) &&
      a.key === b.key &&
      a.day === b.day &&
      b.item.at - a.item.at <= RUN_GAP_S
    const out: Row[] = meta.map((m, i) => {
      const prev = meta[i - 1]
      const next = meta[i + 1]
      const sameAsPrev = Boolean(prev && joins(prev, m))
      const sameAsNext = Boolean(next && joins(m, next))
      return {
        item: m.item,
        author: m.author,
        verified: m.verified,
        body: m.body,
        firstOfRun: !sameAsPrev,
        lastOfRun: !sameAsNext,
        day: !prev || prev.day !== m.day ? m.day : null,
      }
    })
    return out.reverse()
  })()

  const dayLabel = (day: string) => {
    const today = new Date().toDateString()
    const yesterday = new Date(Date.now() - 86_400_000).toDateString()
    if (day === today) return T.today()
    if (day === yesterday) return T.yesterday()
    return new Date(day).toLocaleDateString()
  }

  const renderRow = ({ item: row }: { item: Row }) => {
    const { item } = row
    const separator = row.day ? (
      <View style={styles.pillRow}>
        <Text style={styles.dayPill}>{dayLabel(row.day)}</Text>
      </View>
    ) : null
    if (item.type !== "msg")
      return (
        <View>
          {separator}
          <View style={styles.pillRow}>
            <Text
              style={[styles.noticePill, item.type === "warning" && styles.warningText]}
              testID={
                item.type === "warning" ? "support-chat-warning" : "support-chat-notice"
              }
            >
              {item.type === "warning" ? `⚠ ${item.text}` : capitalized(item.text)}
            </Text>
          </View>
        </View>
      )
    const mine = Boolean(item.mine)
    return (
      <View style={row.firstOfRun ? styles.runStart : styles.runContinue}>
        {separator}
        {!mine && row.firstOfRun && row.author && (
          <Text style={[styles.author, !row.verified && styles.warningText]}>
            {row.verified ? row.author : `⚠ ${row.author}`}
          </Text>
        )}
        <View
          style={[styles.bubble, mine ? styles.mine : styles.theirs]}
          testID="support-chat-message"
        >
          <Text style={[styles.body, mine && styles.bodyMine]}>{row.body}</Text>
        </View>
        {row.lastOfRun && (
          <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>
            {timeOf(item.at)}
          </Text>
        )}
      </View>
    )
  }

  const statusLine =
    !client || client.status === "starting"
      ? T.statusStarting()
      : client.status === "reconnecting"
        ? T.statusReconnecting()
        : client.status === "degraded"
          ? T.statusDegraded()
          : null

  return (
    <Screen preset="fixed" keyboardShouldPersistTaps="handled">
      <Animated.View style={[styles.flex, keyboardLift]}>
        <View style={styles.root} testID="support-chat-screen">
          {statusLine && (
            <View style={styles.statusBar}>
              {client?.status !== "degraded" && (
                <ActivityIndicator size="small" color={colors.primary} />
              )}
              <Text style={styles.statusText}>{statusLine}</Text>
            </View>
          )}

          {(error || actionError) && (
            <Text style={styles.errorText} testID="support-chat-error">
              {error ?? actionError}
            </Text>
          )}

          {sendingBlocked && (
            <Text style={styles.blocked} testID="support-chat-unverified">
              ⚠{" "}
              {T.unverifiedBlocked({ members: unverified.map((m) => m.text).join("; ") })}
            </Text>
          )}

          {client && viewingPast && (
            <View style={styles.card}>
              <Text style={styles.cardText} testID="support-chat-viewing-past">
                {T.viewingPast()}
              </Text>
              {client.groupId && (
                <Pressable onPress={() => client.view(null)} testID="support-chat-back">
                  <Text style={styles.link}>{T.backToCurrent()}</Text>
                </Pressable>
              )}
            </View>
          )}

          {client && current && ended && !viewingPast && (
            <View style={styles.card}>
              <Text style={styles.cardText} testID="support-chat-ended">
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

          <FlatList
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            data={rows}
            inverted={rows.length > 0}
            keyExtractor={(r) => r.item.id}
            renderItem={renderRow}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <GaloyIcon name="headset" size={24} color={colors._green} />
                </View>
                <Text style={styles.emptyTitle}>{T.emptyTitle()}</Text>
                <Text style={styles.emptyBody}>{T.emptyBody()}</Text>
              </View>
            }
          />

          {client && !client.groupId && client.status !== "starting" && (
            <View style={styles.startArea}>
              <GaloyPrimaryButton
                title={busy ? T.starting() : T.start()}
                disabled={busy || client.status !== "ready"}
                onPress={() => run(() => client.start())}
                testID="support-chat-start"
              />
            </View>
          )}

          {canWrite && (
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                placeholder={
                  sendingBlocked
                    ? T.composerBlockedPlaceholder()
                    : T.composerPlaceholder()
                }
                placeholderTextColor={colors.grey2}
                value={draft}
                onChangeText={setDraft}
                editable={!sendingBlocked}
                multiline
                testID="support-chat-input"
              />
              <Pressable
                disabled={sendDisabled}
                onPress={send}
                style={[styles.send, sendDisabled && styles.sendDisabled]}
                testID="support-chat-send"
                accessibilityRole="button"
                accessibilityLabel={T.send()}
              >
                <GaloyIcon name="send" size={20} color={ON_PRIMARY} />
              </Pressable>
            </View>
          )}
        </View>
      </Animated.View>
    </Screen>
  )
}

// blink-brand product surface: type 16/14/12, spacing 3 5 8 10 14 20 30, radii 8/16/999
const useStyles = makeStyles(({ colors }) => ({
  flex: { flex: 1 },
  root: { flex: 1 },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 5,
  },
  statusText: { fontSize: 12, color: colors.grey2 },
  errorText: { fontSize: 14, color: colors.error, paddingHorizontal: 14, paddingTop: 5 },
  blocked: {
    fontSize: 14,
    fontWeight: "bold",
    color: colors.error,
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  card: {
    margin: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.grey5,
    gap: 10,
  },
  cardText: { fontSize: 14, color: colors.grey0 },
  link: { fontSize: 14, color: colors.primary, textDecorationLine: "underline" },
  listContent: { paddingHorizontal: 14, paddingVertical: 10, flexGrow: 1 },
  pillRow: { alignItems: "center", marginVertical: 8 },
  dayPill: {
    fontSize: 12,
    color: colors.grey2,
    backgroundColor: colors.grey5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: "hidden",
  },
  noticePill: {
    fontSize: 12,
    color: colors.grey2,
    backgroundColor: colors.grey5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: "hidden",
    textAlign: "center",
  },
  warningText: { color: colors.error },
  runStart: { marginTop: 10 },
  runContinue: { marginTop: 3 },
  author: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.grey2,
    marginBottom: 3,
    marginLeft: 14,
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  mine: { alignSelf: "flex-end", backgroundColor: colors.primary },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.grey5 },
  body: { fontSize: 16, color: colors.grey0 },
  bodyMine: { color: ON_PRIMARY },
  time: { fontSize: 12, color: colors.grey2, marginTop: 3 },
  timeMine: { alignSelf: "flex-end", marginRight: 5 },
  timeTheirs: { alignSelf: "flex-start", marginLeft: 5 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 10,
    paddingHorizontal: 30,
    paddingTop: 30,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.grey5,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: colors.grey0,
    textAlign: "center",
  },
  emptyBody: { fontSize: 16, color: colors.grey2, textAlign: "center" },
  startArea: { paddingHorizontal: 20, paddingVertical: 14 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.grey4,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.grey0,
    backgroundColor: colors.grey5,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 120, // about 5 lines, then it scrolls
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.5 },
}))
