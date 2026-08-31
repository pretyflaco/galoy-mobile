import React, { createContext, useCallback, useContext, useMemo, useState } from "react"

import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"
import { LnurlDomain } from "@app/self-custodial/config"
import { testProps } from "@app/utils/testProps"
import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { makeStyles, Text, useTheme } from "@rn-vui/themed"

import { GaloyIcon } from "../atomic/galoy-icon"
import CustomModal from "../custom-modal/custom-modal"

type RequiresBlinkAddressPromptContextType = {
  promptRequiresBlinkAddress: () => void
  /** Surfaces that coordinate concurrent modals (e.g. Home) read this. */
  isRequiresBlinkAddressPromptVisible: boolean
}

const RequiresBlinkAddressPromptContext =
  createContext<RequiresBlinkAddressPromptContextType>({
    promptRequiresBlinkAddress: () => {},
    isRequiresBlinkAddressPromptVisible: false,
  })

export const useRequiresBlinkAddressPrompt = (): RequiresBlinkAddressPromptContextType =>
  useContext(RequiresBlinkAddressPromptContext)

type PromptModalProps = {
  onDismiss: () => void
}

const RequiresBlinkAddressPromptModal: React.FC<PromptModalProps> = ({ onDismiss }) => {
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const { LL } = useI18nContext()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  /** The claim flow is a SECONDARY registration: the account keeps its primary domain,
   *  the blink.sv address lands in the alt slot, and Ways-to-get-paid un-gates. */
  const claimBlinkAddress = () => {
    onDismiss()
    navigation.navigate("selfCustodialSetAddress", { domain: LnurlDomain.BlinkSv })
  }

  return (
    <CustomModal
      isVisible={true}
      toggleModal={onDismiss}
      showCloseIconButton={true}
      image={
        <GaloyIcon
          name="warning"
          size={52}
          color={colors.primary}
          {...testProps("requires-blink-address-prompt-icon")}
        />
      }
      title={LL.RequiresBlinkAddressPrompt.title()}
      titleMaxWidth="100%"
      body={
        <Text style={styles.description}>{LL.RequiresBlinkAddressPrompt.body()}</Text>
      }
      primaryButtonTitle={LL.RequiresBlinkAddressPrompt.claimButton()}
      primaryButtonOnPress={claimBlinkAddress}
      secondaryButtonTitle={LL.common.notNow()}
      secondaryButtonOnPress={onDismiss}
      {...testProps("requires-blink-address-prompt")}
    />
  )
}

/** Hosts the single needs-blink-address prompt, mirroring the EnhancedModePrompt
 *  provider: the modal mounts only while visible, and closing removes the native window. */
export const RequiresBlinkAddressPromptProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [isVisible, setIsVisible] = useState(false)

  const promptRequiresBlinkAddress = useCallback(() => setIsVisible(true), [])
  const dismiss = useCallback(() => setIsVisible(false), [])

  const contextValue = useMemo(
    () => ({
      promptRequiresBlinkAddress,
      isRequiresBlinkAddressPromptVisible: isVisible,
    }),
    [promptRequiresBlinkAddress, isVisible],
  )

  return (
    <RequiresBlinkAddressPromptContext.Provider value={contextValue}>
      {children}
      {isVisible && <RequiresBlinkAddressPromptModal onDismiss={dismiss} />}
    </RequiresBlinkAddressPromptContext.Provider>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  description: {
    textAlign: "center",
    fontSize: 16,
    lineHeight: 22,
    color: colors.black,
  },
}))
