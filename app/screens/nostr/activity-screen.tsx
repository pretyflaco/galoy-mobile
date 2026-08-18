import React from "react"
import { FlatList, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { useI18nContext } from "@app/i18n/i18n-react"
import type { ActivityEntry, ActivityStats } from "@app/nostr/core/activity-log"

type Props = {
  entries: ActivityEntry[]
  stats: ActivityStats
}

/** "HH:MM - DD Mon" for an activity timestamp (ms). */
const formatWhen = (ms: number): string => {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const day = d.toLocaleDateString([], { day: "2-digit", month: "short" })
  return `${time} - ${day}`
}

/**
 * Per-client activity history (Amber-style "Show activity"). Renders the METADATA-ONLY log from
 * the activity store: for each request, WHAT method was asked (and, for sign_event, the signed
 * kind), WHEN, and whether we accepted — never the content/payload (leak-audit invariant). A
 * stats card at the top summarizes total/accepted/rejected. Pure presentation; the screen
 * wrapper supplies entries/stats from the runtime. All copy is i18n-sourced.
 */
export const NostrActivityScreen: React.FC<Props> = ({ entries, stats }) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrActivityScreen

  const actionLabel = (e: ActivityEntry): string => {
    if (e.method === "sign_event") {
      return typeof e.eventKind === "number"
        ? T.signEventKind({ kind: e.eventKind })
        : T.signEvent()
    }
    return e.method
  }

  const header = (
    <View style={styles.statsCard} testID="nostr-activity-stats">
      <View style={styles.statCol}>
        <Text type="h1" style={styles.statNum}>
          {stats.total}
        </Text>
        <Text type="p4" style={styles.statLabel}>
          {T.statTotal()}
        </Text>
      </View>
      <View style={styles.statCol}>
        <Text type="h1" style={styles.statNumOk}>
          {stats.accepted}
        </Text>
        <Text type="p4" style={styles.statLabel}>
          {T.statAccepted()}
        </Text>
      </View>
      <View style={styles.statCol}>
        <Text type="h1" style={styles.statNum}>
          {stats.rejected}
        </Text>
        <Text type="p4" style={styles.statLabel}>
          {T.statRejected()}
        </Text>
      </View>
    </View>
  )

  return (
    <View style={styles.container} testID="nostr-activity">
      <FlatList
        data={entries}
        keyExtractor={(_, i) => String(i)}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text type="p1" style={styles.empty} testID="nostr-activity-empty">
            {T.empty()}
          </Text>
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const decision = item.accepted ? T.accepted() : T.rejected()
          const when = formatWhen(item.time)
          return (
            <View
              style={styles.row}
              accessibilityLabel={T.rowA11y({
                action: actionLabel(item),
                decision,
                when,
              })}
            >
              <View style={styles.rowMain}>
                <Text
                  type="p2"
                  style={styles.rowAction}
                  testID={
                    typeof item.eventKind === "number"
                      ? `nostr-activity-kind-${item.eventKind}`
                      : undefined
                  }
                >
                  {actionLabel(item)}
                </Text>
                <Text type="p4" style={styles.rowWhen}>
                  {when}
                </Text>
              </View>
              <View
                style={[styles.badge, item.accepted ? styles.badgeOk : styles.badgeNo]}
                testID={
                  item.accepted ? "nostr-activity-accepted" : "nostr-activity-rejected"
                }
              >
                <Text type="p4" style={styles.badgeText}>
                  {decision}
                </Text>
              </View>
            </View>
          )
        }}
      />
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 20,
    rowGap: 8,
  },
  statsCard: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: colors.grey5,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  statCol: {
    alignItems: "center",
    rowGap: 3,
  },
  statNum: {
    color: colors.black,
  },
  statNumOk: {
    color: colors._green,
  },
  statLabel: {
    color: colors.grey2,
  },
  empty: {
    color: colors.grey2,
    textAlign: "center",
    marginTop: 30,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey4,
  },
  rowMain: {
    flex: 1,
    rowGap: 3,
  },
  rowAction: {
    color: colors.black,
    fontWeight: "600",
  },
  rowWhen: {
    color: colors.grey2,
  },
  badge: {
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  badgeOk: {
    backgroundColor: colors._green,
  },
  badgeNo: {
    backgroundColor: colors.grey4,
  },
  badgeText: {
    color: colors.white,
    fontWeight: "600",
  },
}))
