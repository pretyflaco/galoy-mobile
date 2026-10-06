import React from "react"

import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { useFeatureFlags } from "@app/config/feature-flags-context"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"

import { useRunningSupportChat } from "@app/support-chat/registry"

import { SettingsRow } from "../row"

/** Support chat: self-gating entry; invisible unless supportChatEnabled. M19: "Support". */
export const SupportChatPocSetting: React.FC = () => {
  const { LL } = useI18nContext()
  const { supportChatEnabled } = useFeatureFlags()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const unread = useRunningSupportChat()?.unread ?? 0

  if (!supportChatEnabled) return null

  return (
    <SettingsRow
      title={LL.SupportChatScreen.title()}
      subtitle={
        unread
          ? `● ${unread} new message${unread === 1 ? "" : "s"} from Blink Support`
          : undefined
      }
      leftGaloyIcon="headset"
      action={() => navigation.navigate("supportChat")}
    />
  )
}
