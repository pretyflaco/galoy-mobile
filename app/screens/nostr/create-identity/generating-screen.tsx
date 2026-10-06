import React, { useEffect, useRef } from "react"
import { Animated, Easing, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

import type { IdentityKeySource } from "./use-create-identity"

type Props = {
  /** Drives the copy variant: derived from the wallet phrase vs. a brand-new random key. */
  source: IdentityKeySource
}

/**
 * Transient Generating step (spec §7.4, Figma 23238:102905 / 23263:103918): key → nostr
 * animation while the key is created. This is the ONLY screen between the create decision
 * and the Hub — no confirm step, no result/ownership screen.
 */
export const NostrGeneratingScreen: React.FC<Props> = ({ source }) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrCreateIdentityScreen
  const pulse = useRef(new Animated.Value(0.35)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [pulse])

  return (
    <View style={styles.container} {...testProps("nostr-generating")}>
      <View style={styles.animationRow}>
        <GaloyIcon name="key-outline" size={52} color={styles.icon.color} />
        <View style={styles.dashedLine} />
        <Animated.View style={{ opacity: pulse }}>
          <GaloyIcon name="nostr" width={52} height={52} color={styles.icon.color} />
        </Animated.View>
      </View>
      <Text type="h2" bold style={styles.title}>
        {source === "seed" ? T.generatingFromSeed() : T.generatingRandom()}
      </Text>
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 48,
    rowGap: 20,
  },
  animationRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 18,
  },
  dashedLine: {
    width: 89,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: colors.grey3,
  },
  icon: {
    color: colors.grey0,
  },
  title: {
    color: colors.grey0,
    textAlign: "center",
  },
}))
