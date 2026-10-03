import React, { useMemo, useState } from "react"
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { FlatList, Pressable, ScrollView, View } from "react-native"
import { Text } from "@rn-vui/themed"

import { Screen } from "@app/components/screen"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import type { TransactionFragment } from "@app/graphql/generated"
import { useAccountTransactions } from "@app/hooks/use-account-transactions"
import { useAccountRegistry } from "@app/hooks/use-account-registry"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"
import { useSelfCustodialTransactionFragments } from "@app/self-custodial/hooks/use-self-custodial-transaction-fragments"
import { useSelfCustodialWallet } from "@app/self-custodial/providers/wallet"
import { AccountType } from "@app/types/wallet"

import { detailsTags, detailsText, transactionFields } from "@app/support-chat/details"
import { useSelfCustodialPaymentIds } from "@app/support-chat/use-share-details"
import { useSupportChat } from "@app/support-chat/use-support-chat"

import { useShareStyles } from "./support-share-details-screen"

const NONE: never[] = []
const RECENT = 30

/**
 * "Share a transaction" (M19): pick one of the recent payments (or arrive with one from
 * its detail screen: `txid` param), review the exact text, send. For self-custodial
 * payments the real payment hash / txid are read from the wallet SDK.
 */
export const SupportShareTransactionScreen: React.FC = () => {
  const { LL } = useI18nContext()
  const T = LL.SupportShareScreen
  const styles = useShareStyles()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, "supportChatShareTransaction">>()
  const { client } = useSupportChat()
  const { activeAccount } = useAccountRegistry()
  const selfCustodial = activeAccount?.type === AccountType.SelfCustodial
  const { allTransactions } = useSelfCustodialWallet()
  const selfCustodialFragments = useSelfCustodialTransactionFragments(
    selfCustodial ? allTransactions : NONE,
  )
  const custodial = useAccountTransactions({ isSelfCustodial: selfCustodial })
  const list: readonly TransactionFragment[] = useMemo(
    () => (selfCustodial ? selfCustodialFragments : custodial).slice(0, RECENT),
    [selfCustodial, selfCustodialFragments, custodial],
  )

  const [pickedId, setPickedId] = useState<string | null>(route.params?.txid ?? null)
  const picked = pickedId ? list.find((t) => t.id === pickedId) ?? null : null
  const ids = useSelfCustodialPaymentIds(selfCustodial && picked ? picked.id : null)
  const fields = picked
    ? transactionFields(picked, selfCustodial ? ids ?? { paymentId: picked.id } : {})
    : []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    if (!client || !fields.length) return
    setBusy(true)
    setError(null)
    try {
      await client.ensureConversation()
      await client.send(
        detailsText("transaction", fields),
        detailsTags("transaction", fields),
      )
      navigation.navigate("supportChat")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const rowLabel = (t: TransactionFragment) =>
    `${t.direction === "SEND" ? T.sent() : T.received()} · ${Math.abs(t.settlementAmount)} ${
      t.settlementCurrency === "BTC" ? "sats" : "USD cents"
    }`

  if (!picked)
    return (
      <Screen preset="fixed">
        <View style={styles.flex} testID="support-share-transaction-screen">
          <Text style={[styles.intro, styles.content]}>
            {pickedId ? T.notFound() : T.transactionIntro()}
          </Text>
          <FlatList
            data={list}
            keyExtractor={(t) => t.id}
            renderItem={({ item: t }) => (
              <Pressable
                style={[styles.row, styles.listRow]}
                onPress={() => setPickedId(t.id)}
                testID="support-share-transaction-row"
              >
                <View style={styles.rowText}>
                  <Text style={styles.value}>{rowLabel(t)}</Text>
                  <Text style={styles.label}>
                    {new Date(t.createdAt * 1000).toLocaleString()} ·{" "}
                    {String(t.status).toLowerCase()}
                  </Text>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={[styles.intro, styles.content]}>{T.noTransactions()}</Text>
            }
          />
        </View>
      </Screen>
    )

  return (
    <Screen preset="fixed">
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        testID="support-share-transaction-screen"
      >
        <Text style={styles.previewTitle}>{T.preview()}</Text>
        <Text style={styles.preview} selectable testID="support-share-preview">
          {detailsText("transaction", fields)}
        </Text>
        <Pressable onPress={() => setPickedId(null)} testID="support-share-choose-other">
          <Text style={styles.intro}>{T.chooseOther()}</Text>
        </Pressable>
        <Text style={styles.never}>{T.never()}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.bottom}>
        <GaloyPrimaryButton
          title={busy ? T.sending() : T.send()}
          disabled={busy || !client}
          onPress={send}
          testID="support-share-send"
        />
      </View>
    </Screen>
  )
}
