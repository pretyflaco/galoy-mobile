import React, { useState } from "react"
import { View } from "react-native"
import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { makeStyles, useTheme } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { IconHero } from "@app/components/icon-hero"
import { OptionCard, OptionCardGroup } from "@app/components/option-card-group"
import { useFeatureFlags } from "@app/config/feature-flags-context"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"
import { DEFAULT_MAINNET_LNURL_DOMAIN, LnurlDomain } from "@app/self-custodial/config"
import { testProps } from "@app/utils/testProps"

import { OnboardingScreenLayout } from "./layouts"

const DOMAIN_ICON_SIZE = 22

/**
 * Lets a self-custodial user pick the domain their Lightning Address ends with. The choice
 * is fixed per account once the address exists, so this screen only ever runs before the
 * first registration (the settings row routes elsewhere once an address is present).
 *
 * The twentyone.ist option is always visible so the user knows it exists, but stays
 * greyed out until the delegatedGrantsEnabled feature flag turns its server on. Selecting
 * a domain hands it to the username screen, which writes it to the account and reconnects
 * the SDK against it before registering.
 */
export const ChooseLnurlDomainScreen: React.FC = () => {
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const { LL } = useI18nContext()
  const LLScreen = LL.ChooseLnurlDomainScreen
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { delegatedGrantsEnabled } = useFeatureFlags()

  const [selected, setSelected] = useState<LnurlDomain>(DEFAULT_MAINNET_LNURL_DOMAIN)

  const options: OptionCard<LnurlDomain>[] = [
    {
      key: LnurlDomain.BlinkSv,
      icon: "magic-wand",
      iconSize: DOMAIN_ICON_SIZE,
      title: LLScreen.blinkSvLabel(),
      description: LLScreen.blinkSvDescription(),
      testID: "lnurl-domain-blink-sv",
    },
    {
      key: LnurlDomain.TwentyoneIst,
      icon: "globe",
      iconSize: DOMAIN_ICON_SIZE,
      title: LLScreen.twentyoneIstLabel(),
      description: LLScreen.twentyoneIstDescription(),
      disabled: !delegatedGrantsEnabled,
      disabledBadge: delegatedGrantsEnabled
        ? undefined
        : LLScreen.twentyoneIstUnavailable(),
      testID: "lnurl-domain-twentyone-ist",
    },
  ]

  const handleContinue = () => {
    navigation.navigate("selfCustodialSetAddress", { domain: selected })
  }

  return (
    <OnboardingScreenLayout
      footer={
        <GaloyPrimaryButton
          title={LLScreen.continueButton()}
          onPress={handleContinue}
          {...testProps("choose-lnurl-domain-continue")}
        />
      }
    >
      <IconHero
        icon="lightning-address"
        iconColor={colors.primary}
        title={LLScreen.title()}
        subtitle={LLScreen.subtitle()}
      />

      <View style={styles.options}>
        <OptionCardGroup
          options={options}
          selectedKey={selected}
          onSelect={setSelected}
        />
      </View>
    </OnboardingScreenLayout>
  )
}

const useStyles = makeStyles(() => ({
  options: {
    marginTop: 30,
  },
}))
