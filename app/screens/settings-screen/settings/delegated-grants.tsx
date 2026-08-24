import React from "react"

import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { useFeatureFlags } from "@app/config/feature-flags-context"
import { useI18nContext } from "@app/i18n/i18n-react"
import { useNostrAccountMode } from "@app/nostr/use-nostr-account-key"
import { RootStackParamList } from "@app/navigation/stack-param-lists"

import { SettingsRow } from "../row"

/**
 * "Receive-only access" settings row for LNbits delegated grants (D2 POC).
 *
 * Double-gated (AC-7 / AC-8): renders ONLY on a self-custodial account with the
 * `delegatedGrantsEnabled` remote flag on. Custodial accounts never see the feature —
 * matching the D2 server requirement that the granting key belong to a Spark account.
 */
export const DelegatedGrantsSetting: React.FC = () => {
  const { LL } = useI18nContext()
  const { delegatedGrantsEnabled } = useFeatureFlags()
  const { isSelfCustodial } = useNostrAccountMode()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  if (!delegatedGrantsEnabled || !isSelfCustodial) return null

  return (
    <SettingsRow
      title={LL.DelegatedGrantsScreen.settingsRow()}
      subtitle={LL.DelegatedGrantsScreen.settingsRowSubtitle()}
      leftGaloyIcon="key-outline"
      action={() => navigation.navigate("delegatedGrants")}
    />
  )
}
