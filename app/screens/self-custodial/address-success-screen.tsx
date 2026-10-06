import React, { useEffect } from "react"
import { View } from "react-native"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { Screen } from "@app/components/screen"
import {
  SuccessIconAnimation,
  CompletedTextAnimation,
} from "@app/components/success-animation"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { Text, makeStyles } from "@rn-vui/themed"

const CALLBACK_DELAY = 3000

/** Confirmation after a Lightning Address registers (primary or second-domain): same
 *  pattern as the mode-switch success screen — animation, the new address, then back to
 *  Settings where the address now shows. */
export const AddressSuccessScreen = () => {
  const styles = useStyles()

  const navigation =
    useNavigation<
      NativeStackNavigationProp<RootStackParamList, "selfCustodialAddressSuccess">
    >()
  const route = useRoute<RouteProp<RootStackParamList, "selfCustodialAddressSuccess">>()

  const { LL } = useI18nContext()

  useEffect(() => {
    /** navigate (not goBack) so the user lands on Settings — where they started the
     *  flow — not on the username/domain screens underneath. */
    const timeout = setTimeout(() => navigation.navigate("settings"), CALLBACK_DELAY)
    return () => clearTimeout(timeout)
  }, [navigation])

  return (
    <Screen preset="scroll" style={styles.screen} headerShown={false}>
      <View style={styles.container}>
        <SuccessIconAnimation>
          <GaloyIcon name={"payment-success"} size={128} />
        </SuccessIconAnimation>
        <CompletedTextAnimation>
          <Text type="h2" style={styles.successText}>
            {LL.AddressSuccessScreen.title()}
          </Text>
          <Text type="h2" style={styles.successText}>
            {route.params.address}
          </Text>
        </CompletedTextAnimation>
      </View>
    </Screen>
  )
}

const useStyles = makeStyles(() => ({
  successText: {
    marginTop: 20,
    paddingHorizontal: 20,
    textAlign: "center",
  },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  screen: {
    flexGrow: 1,
  },
}))
