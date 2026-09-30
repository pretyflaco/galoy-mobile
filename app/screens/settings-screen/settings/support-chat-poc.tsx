import React from "react"

import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { useFeatureFlags } from "@app/config/feature-flags-context"
import { RootStackParamList } from "@app/navigation/stack-param-lists"

import { SettingsRow } from "../row"

/** Support chat (P1): self-gating entry; invisible unless supportChatEnabled. */
export const SupportChatPocSetting: React.FC = () => {
  const { supportChatEnabled } = useFeatureFlags()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  if (!supportChatEnabled) return null

  return (
    <SettingsRow
      title="Support chat"
      subtitle="End-to-end encrypted chat with Blink Support"
      leftGaloyIcon="headset"
      action={() => navigation.navigate("supportChatPoc")}
    />
  )
}
