/**
 * Values for "Share details" (details.ts), read from the same sources as Settings →
 * Account information — nothing is sent from here; the share screens show every value
 * and the customer picks what goes out.
 *   - app version + OS: react-native-device-info (as the "Contact us" e-mail does)
 *   - custodial: account ID (me.defaultAccount.id) and username@host Lightning address
 *   - self-custodial: the wallet identifier (Breez Spark identityPubkey) and the
 *     effective Lightning address
 * Before an account exists only the app version is offered.
 */
import { useEffect, useMemo, useState } from "react"
import { Platform } from "react-native"
import { getReadableVersion } from "react-native-device-info"
import { GetPaymentRequest } from "@breeztech/breez-sdk-spark-react-native"

import { useIsAuthed } from "@app/graphql/is-authed-context"
import { useSettingsScreenQuery } from "@app/graphql/generated"
import { useAppConfig } from "@app/hooks"
import { useAccountRegistry } from "@app/hooks/use-account-registry"
import { useAccountLightningAddresses } from "@app/self-custodial/hooks/use-account-lightning-addresses"
import { useSelfCustodialAccountInfo } from "@app/self-custodial/hooks/use-self-custodial-account-info"
import { useSelfCustodialAccountMode } from "@app/self-custodial/hooks/use-self-custodial-account-mode"
import {
  extractPaymentHash,
  extractTxHash,
} from "@app/self-custodial/mappers/transaction-csv"
import { useSelfCustodialWallet } from "@app/self-custodial/providers/wallet"
import { AccountType } from "@app/types/wallet"
import { getLightningAddress } from "@app/utils/pay-links"

import type { DetailField } from "./details"

export const appVersionField = (): DetailField => ({
  key: "app_version",
  label: "App",
  value: `Blink ${getReadableVersion()} (${Platform.OS === "ios" ? "iOS" : "Android"} ${Platform.Version})`,
})

/** All account fields we can offer right now (empty values are left out). */
export const useAccountDetailFields = (): { fields: DetailField[]; loading: boolean } => {
  const { activeAccount } = useAccountRegistry()
  const isAuthed = useIsAuthed()
  const { appConfig } = useAppConfig()
  const type = activeAccount?.type
  const selfCustodial = type === AccountType.SelfCustodial
  const custodial = type === AccountType.Custodial

  const { data, loading: custodialLoading } = useSettingsScreenQuery({
    skip: !custodial || !isAuthed,
  })
  const info = useSelfCustodialAccountInfo()
  const { effective, primary, alt } = useAccountLightningAddresses()
  const { accountMode } = useSelfCustodialAccountMode()

  const fields = useMemo(() => {
    const out: DetailField[] = [appVersionField()]
    if (!type) return out
    out.push({
      key: "account_type",
      label: "Account",
      value: selfCustodial
        ? `non-custodial${accountMode ? ` (${accountMode === "anon" ? "Incognito" : "Enhanced"})` : ""}`
        : "custodial",
    })
    if (custodial) {
      const id = data?.me?.defaultAccount?.id
      const username = data?.me?.username
      if (id) out.push({ key: "account_id", label: "Account ID", value: id })
      if (username)
        out.push({
          key: "ln_address",
          label: "Lightning address",
          value: getLightningAddress(appConfig.galoyInstance.lnAddressHostname, username),
        })
    }
    if (selfCustodial) {
      if (info.identityPubkey)
        out.push({
          key: "wallet_id",
          label: "Wallet identifier",
          value: info.identityPubkey,
        })
      const ln = effective ?? primary ?? alt ?? info.lightningAddress
      if (ln) out.push({ key: "ln_address", label: "Lightning address", value: ln })
    }
    return out
  }, [
    type,
    selfCustodial,
    custodial,
    accountMode,
    data,
    appConfig.galoyInstance.lnAddressHostname,
    info.identityPubkey,
    info.lightningAddress,
    effective,
    primary,
    alt,
  ])

  return {
    fields,
    loading: (custodial && custodialLoading) || (selfCustodial && info.loading),
  }
}

/**
 * Self-custodial payments: the transaction fragment holds the Breez payment id in its
 * hash fields, so the real payment hash / on-chain txid come from the SDK payment.
 */
export const useSelfCustodialPaymentIds = (
  paymentId: string | null,
): { paymentHash?: string; txid?: string; paymentId?: string } | null => {
  const { sdk } = useSelfCustodialWallet()
  const [ids, setIds] = useState<{
    paymentHash?: string
    txid?: string
    paymentId?: string
  } | null>(null)
  useEffect(() => {
    if (!sdk || !paymentId) return undefined
    let cancelled = false
    sdk
      .getPayment(GetPaymentRequest.create({ paymentId }))
      .then((r) => {
        if (cancelled) return
        const details = r.payment.details
        setIds({
          paymentId,
          paymentHash: extractPaymentHash(details),
          txid: extractTxHash(details),
        })
      })
      .catch(() => !cancelled && setIds({ paymentId }))
    return () => {
      cancelled = true
    }
  }, [sdk, paymentId])
  return ids
}
