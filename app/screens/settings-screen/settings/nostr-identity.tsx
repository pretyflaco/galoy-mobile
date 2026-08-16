import React from "react"

import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { useFeatureFlags } from "@app/config/feature-flags-context"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"

import { SettingsRow } from "../row"

/**
 * Nostr Identity settings row (Story A2 / AD-13). Self-gating: renders ONLY when the
 * `nostrSignerEnabled` remote flag is on — flag OFF ⇒ the signer is invisible (returns null),
 * exactly like the other mode-gated rows. Navigates to the Nostr Identity hub, which decides
 * empty-state (create/import) vs. summary (backup/replace/connected clients/scan-to-connect).
 */
export const NostrIdentitySetting: React.FC = () => {
  const { LL } = useI18nContext()
  const { nostrSignerEnabled } = useFeatureFlags()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  if (!nostrSignerEnabled) return null

  return (
    <SettingsRow
      title={LL.NostrIdentityScreen.settingsRow()}
      subtitle={LL.NostrIdentityScreen.settingsRowSubtitle()}
      leftGaloyIcon="key-outline"
      action={() => navigation.navigate("nostrIdentity")}
    />
  )
}
