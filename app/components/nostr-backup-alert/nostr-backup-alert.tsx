import React, { useCallback, useEffect } from "react"

import { useIsFocused, useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { useFeatureFlags } from "@app/config/feature-flags-context"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"
import { useNostrBackupState } from "@app/nostr/use-nostr-backup-state"
import { testProps } from "@app/utils/testProps"

import { NotificationCardUI } from "../notifications/notification-card-ui"

/**
 * Blink Home security alert (spec §7.14): surfaces the un-backed-up Nostr identity
 * OUTSIDE the feature so users act on it. Shown whenever an identity exists and no
 * backup method has completed (the expected default on custodial accounts — the nudge
 * IS the security model). NOT dismissible: it clears only when the backup completes
 * (consistent with the Hub banner). Tap routes into the backup flow.
 */
export const NostrBackupAlert: React.FC = () => {
  const { LL } = useI18nContext()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { nostrSignerEnabled } = useFeatureFlags()
  const { loading, hasIdentity, backedUp, reload } = useNostrBackupState()
  const isFocused = useIsFocused()

  // Refresh on focus — a completed backup flow writes the marker before returning Home.
  useEffect(() => {
    if (isFocused) reload()
  }, [isFocused, reload])

  const handleAction = useCallback(async () => {
    navigation.navigate("nostrBackup")
  }, [navigation])

  if (!nostrSignerEnabled || loading || !hasIdentity || backedUp) return null

  const T = LL.NostrIdentityScreen
  return (
    <NotificationCardUI
      title={T.backupBannerTitle()}
      text={T.backupBannerBody()}
      icon="key-outline"
      action={handleAction}
      buttonLabel={T.backupBannerCta()}
      {...testProps("nostr-backup-alert")}
    />
  )
}
