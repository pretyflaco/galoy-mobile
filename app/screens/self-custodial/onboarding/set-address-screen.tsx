import React, { useEffect, useState } from "react"
import { View, TextInput } from "react-native"
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { makeStyles, useTheme, Text } from "@rn-vui/themed"

import { GaloyErrorBox } from "@app/components/atomic/galoy-error-box"
import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { IconHero } from "@app/components/icon-hero"
import {
  SetUsernameError,
  validateUsername,
} from "@app/components/set-lightning-address-modal/username-validation"
import { useAccountRegistry } from "@app/hooks/use-account-registry"
import { useInFlightGuard } from "@app/hooks/use-in-flight-guard"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"
import {
  checkLightningAddressAvailable,
  registerLightningAddress,
  signMessageWithIdentityKey,
} from "@app/self-custodial/bridge"
import { lnurlServerUrlFor, LnurlDomain } from "@app/self-custodial/config"
import {
  checkAddressAvailableOnDomain,
  LnurlRegisterError,
  registerAddressOnDomain,
} from "@app/self-custodial/lnurl-register"
import { BackupStatus, useBackupState } from "@app/self-custodial/providers/backup-state"
import { useSelfCustodialWallet } from "@app/self-custodial/providers/wallet"
import { useSparkNetwork } from "@app/self-custodial/hooks/use-spark-network"
import {
  setSelfCustodialAltLightningAddress,
  setSelfCustodialLnurlDomain,
} from "@app/self-custodial/storage/account-index"
import { ActiveWalletStatus } from "@app/types/wallet"
import { reportError } from "@app/utils/error-logging"
import { testProps } from "@app/utils/testProps"

import { OnboardingScreenLayout } from "./layouts"

/**
 * Username entry for a self-custodial Lightning Address, in two modes:
 *
 * PRIMARY (first registration): the domain was picked on the previous screen; this screen
 * writes it to the account (which reconnects the SDK against that server), waits for the
 * SDK to be live on the chosen domain, then registers via the SDK. The "cannot be changed
 * later" rule applies to both the username and — once registered — the domain.
 *
 * SECONDARY (the account already holds an address on the OTHER domain): the SDK must not
 * reconnect — it stays bound to the primary server. Registration goes directly against
 * this domain's server as a signed REST call (lnurl-register.ts), the address lands in
 * the account's alt slot, and the primary address is untouched.
 */
export const SetSelfCustodialAddressScreen: React.FC = () => {
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const { LL } = useI18nContext()
  const LLScreen = LL.SetSelfCustodialAddressScreen
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, "selfCustodialSetAddress">>()
  const { domain } = route.params

  const { activeAccount, selfCustodialEntries, reloadSelfCustodialAccounts } =
    useAccountRegistry()
  const {
    sdk,
    status,
    connectedAccountId,
    connectedLnurlDomain,
    updateCurrentSelfCustodialAccount,
  } = useSelfCustodialWallet()
  const { backupState } = useBackupState()
  const network = useSparkNetwork()
  const guard = useInFlightGuard()

  const [lnAddress, setLnAddress] = useState("")
  const [error, setError] = useState<SetUsernameError | undefined>()
  const [registering, setRegistering] = useState(false)

  const accountId = activeAccount?.id
  const activeEntry = selfCustodialEntries.find((entry) => entry.id === accountId)

  /** Secondary when the account already holds an address on a DIFFERENT domain than the
   *  one being registered: the SDK stays on the primary server and this registration is
   *  a signed REST call against the chosen domain instead. */
  const existingAddress = activeEntry?.lightningAddress ?? null
  const existingDomain = existingAddress?.split("@")[1]?.trim().toLowerCase()
  const isSecondary = Boolean(existingAddress) && existingDomain !== domain

  /** PRIMARY ONLY: persist the chosen domain up front — the wallet provider reads the
   *  entry and reconnects the SDK against that server, so by the time the user submits
   *  the SDK is already bound to the right LNURL host. Secondary registration must NOT
   *  touch the stored domain: the SDK remains bound to the primary server. */
  useEffect(() => {
    if (!accountId || isSecondary) return
    setSelfCustodialLnurlDomain(accountId, domain)
      .then(() => reloadSelfCustodialAccounts())
      .catch((err) => reportError("Persist LNURL domain choice", err))
  }, [accountId, domain, isSecondary, reloadSelfCustodialAccounts])

  /** PRIMARY registration must not run against the wrong server: the SDK is connected
   *  when its account and domain both match. SECONDARY only needs the SDK live on the
   *  right account — the identity key signs regardless of the connected lnurl domain. */
  const isSdkReady = isSecondary
    ? status === ActiveWalletStatus.Ready &&
      sdk !== null &&
      connectedAccountId === accountId
    : status === ActiveWalletStatus.Ready &&
      sdk !== null &&
      connectedAccountId === accountId &&
      connectedLnurlDomain === domain

  const onChangeLnAddress = (value: string) => {
    setLnAddress(value)
    setError(undefined)
  }

  const goToSuccess = (address: string) =>
    navigation.replace("selfCustodialAddressSuccess", { address })

  const handleRegisterPrimary = async (): Promise<boolean> => {
    if (!sdk) return false
    const available = await checkLightningAddressAvailable(sdk, lnAddress)
    if (!available) {
      setError(SetUsernameError.ADDRESS_UNAVAILABLE)
      return false
    }
    await registerLightningAddress(sdk, lnAddress)
    await updateCurrentSelfCustodialAccount()
    goToSuccess(`${lnAddress.toLowerCase()}@${domain}`)
    return true
  }

  const handleRegisterSecondary = async (): Promise<boolean> => {
    if (!sdk || !accountId) return false
    const base = lnurlServerUrlFor(network, domain)
    const signMessage = (message: string) => signMessageWithIdentityKey(sdk, message)
    try {
      const available = await checkAddressAvailableOnDomain(base, lnAddress)
      if (!available) {
        setError(SetUsernameError.ADDRESS_UNAVAILABLE)
        return false
      }
      const address = await registerAddressOnDomain({
        base,
        username: lnAddress,
        signMessage,
      })
      await setSelfCustodialAltLightningAddress(accountId, address)
      await reloadSelfCustodialAccounts()
      goToSuccess(address)
      return true
    } catch (err) {
      if (err instanceof LnurlRegisterError && err.kind === "taken") {
        setError(SetUsernameError.ADDRESS_UNAVAILABLE)
        return false
      }
      throw err
    }
  }

  const handleRegister = async () => {
    await guard.run(async () => {
      if (backupState.status !== BackupStatus.Completed) {
        setError(SetUsernameError.BACKUP_REQUIRED)
        return
      }
      const validation = validateUsername(lnAddress)
      if (!validation.valid) {
        setError(validation.error)
        return
      }
      if (!sdk || !isSdkReady) {
        setError(SetUsernameError.UNKNOWN_ERROR)
        return
      }

      setRegistering(true)
      try {
        if (isSecondary) {
          await handleRegisterSecondary()
        } else {
          await handleRegisterPrimary()
        }
      } catch (err) {
        reportError("Register Lightning address", err)
        setError(SetUsernameError.UNKNOWN_ERROR)
      } finally {
        setRegistering(false)
      }
    })
  }

  let errorMessage = ""
  switch (error) {
    case SetUsernameError.TOO_SHORT:
      errorMessage = LLScreen.Errors.tooShort()
      break
    case SetUsernameError.TOO_LONG:
      errorMessage = LLScreen.Errors.tooLong()
      break
    case SetUsernameError.INVALID_CHARACTER:
      errorMessage = LLScreen.Errors.invalidCharacter()
      break
    case SetUsernameError.ADDRESS_UNAVAILABLE:
      errorMessage = LLScreen.Errors.addressUnavailable()
      break
    case SetUsernameError.BACKUP_REQUIRED:
      errorMessage = LLScreen.Errors.backupRequired()
      break
    case SetUsernameError.UNKNOWN_ERROR:
    case undefined:
      errorMessage = error ? LLScreen.Errors.unknownError() : ""
      break
  }

  return (
    <OnboardingScreenLayout
      footer={
        <GaloyPrimaryButton
          title={LLScreen.setAddressButton()}
          onPress={handleRegister}
          disabled={!lnAddress || !isSdkReady}
          loading={registering || (!isSdkReady && Boolean(sdk))}
          {...testProps("set-self-custodial-address-submit")}
        />
      }
    >
      <IconHero
        icon="lightning-address"
        iconColor={colors.primary}
        title={LLScreen.title()}
        subtitle={LLScreen.onDomain({ domain })}
      />

      <View style={styles.body}>
        <View style={styles.textInputContainerStyle}>
          <TextInput
            autoCorrect={false}
            autoComplete="off"
            autoCapitalize="none"
            style={styles.textInputStyle}
            onChangeText={onChangeLnAddress}
            value={lnAddress}
            placeholder={LLScreen.addressPlaceholder()}
            placeholderTextColor={colors.grey3}
            {...testProps("set-self-custodial-address-input")}
          />
          <Text type="p1">{`@${domain}`}</Text>
        </View>
        {errorMessage ? <GaloyErrorBox errorMessage={errorMessage} /> : null}
      </View>
    </OnboardingScreenLayout>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  body: {
    marginTop: 30,
    rowGap: 20,
  },
  textInputContainerStyle: {
    display: "flex",
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    minHeight: 60,
    backgroundColor: colors.grey4,
    alignItems: "center",
    justifyContent: "space-between",
  },
  textInputStyle: {
    paddingTop: 0,
    paddingBottom: 0,
    flex: 1,
    textAlignVertical: "center",
    fontSize: 18,
    lineHeight: 24,
    color: colors.black,
  },
}))

/** Re-exported so the route param type stays tied to the domain enum. */
export type { LnurlDomain }
