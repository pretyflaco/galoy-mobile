import React, { useState } from "react"
import { TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

import type { IdentityKeySource } from "./use-create-identity"

type Props = {
  onChoose: (source: IdentityKeySource) => void
}

/**
 * Create new — choose key source (spec §7.3, Figma 23233:102425). Shown ONLY on
 * self-custodial accounts whose wallet seed is already backed up; the navigator never
 * renders it otherwise. No key is generated here — the choice starts generation.
 */
export const NostrChooseKeySourceScreen: React.FC<Props> = ({ onChoose }) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const [expanded, setExpanded] = useState(false)
  const T = LL.NostrCreateIdentityScreen

  return (
    <View style={styles.container} {...testProps("nostr-create-choose-source")}>
      <View style={styles.hero}>
        <View style={styles.iconCircle}>
          <GaloyIcon name="key-outline" size={32} color={styles.icon.color} />
        </View>
        <Text type="h2" bold style={styles.title}>
          {T.chooseTitle()}
        </Text>
        <Text type="p2" style={styles.body}>
          {T.chooseBody()}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((v) => !v)}
        >
          <Text type="p2" style={styles.learnMore}>
            {T.chooseLearnMore()}
          </Text>
        </TouchableOpacity>
        {expanded ? (
          <Text type="p2" style={styles.body}>
            {T.introLearnMoreBody()}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <GaloyPrimaryButton
          title={T.chooseFromWallet()}
          onPress={() => onChoose("seed")}
          {...testProps("nostr-create-from-wallet")}
        />
        <GaloySecondaryButton
          title={T.chooseNew()}
          onPress={() => onChoose("random")}
          {...testProps("nostr-create-new-random")}
        />
      </View>
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    justifyContent: "space-between",
  },
  hero: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 20,
    rowGap: 14,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.grey5,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    color: colors.grey0,
  },
  title: {
    color: colors.grey0,
    textAlign: "center",
  },
  body: {
    color: colors.grey1,
    textAlign: "center",
  },
  learnMore: {
    color: colors.grey1,
    textDecorationLine: "underline",
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    rowGap: 10,
  },
}))
