import React from "react"

import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { useFeatureFlags } from "@app/config/feature-flags-context"
import { RootStackParamList } from "@app/navigation/stack-param-lists"

import { useRunningSupportChat } from "@app/support-chat/use-support-chat"

import { SettingsRow } from "../row"

/** Support chat (P1): self-gating entry; invisible unless supportChatEnabled. */
export const SupportChatPocSetting: React.FC = () => {
  const { supportChatEnabled } = useFeatureFlags()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const unread = useRunningSupportChat()?.unread ?? 0

  if (!supportChatEnabled) return null

  return (
    <SettingsRow
      title="Support chat"
      subtitle={
        unread
          ? `● ${unread} new message${unread === 1 ? "" : "s"} from Blink Support`
          : "End-to-end encrypted chat with Blink Support"
      }
      leftGaloyIcon="headset"
      action={() => navigation.navigate("supportChat")}
    />
  )
}
