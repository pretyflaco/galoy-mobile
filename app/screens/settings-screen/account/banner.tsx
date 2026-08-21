/**
 * This component is the top banner on the settings screen
 * It shows the user their own username with a people icon
 * If the user isn't logged in, it shows Login or Create Account
 * Later on, this will support switching between accounts
 */
import React from "react"
import { Image, TouchableOpacity, View } from "react-native"
import { TouchableWithoutFeedback } from "react-native-gesture-handler"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { useFeatureFlags } from "@app/config/feature-flags-context"
import { useSettingsScreenQuery } from "@app/graphql/generated"
import { useIsAuthed } from "@app/graphql/is-authed-context"
import { AccountLevel, useLevel } from "@app/graphql/level-context"
import { useAppConfig, useClipboard } from "@app/hooks"
import { useAccountRegistry } from "@app/hooks/use-account-registry"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"
import { useNostrProfilePicture } from "@app/nostr/use-nostr-profile-picture"
import { useSelfCustodialWallet } from "@app/self-custodial/providers/wallet"
import { useNostrIdentity } from "@app/screens/nostr/identity-hub/use-nostr-identity"
import { AccountType } from "@app/types/wallet"
import { useNavigation, useIsFocused } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { Text, makeStyles, useTheme, Skeleton } from "@rn-vui/themed"

export const AccountBanner: React.FC = () => {
  const { activeAccount } = useAccountRegistry()

  if (activeAccount?.type === AccountType.SelfCustodial) {
    return <SelfCustodialAccountBanner />
  }
  return <CustodialAccountBanner />
}

const CustodialAccountBanner: React.FC = () => {
  const styles = useStyles()
  const { LL } = useI18nContext()
  const {
    appConfig: {
      galoyInstance: { lnAddressHostname },
    },
  } = useAppConfig()

  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const { currentLevel } = useLevel()
  const isUserLoggedIn = currentLevel !== AccountLevel.NonAuth
  const isAuthed = useIsAuthed()

  const { data, loading } = useSettingsScreenQuery({
    skip: !isAuthed,
    fetchPolicy: "cache-first",
  })

  const hasUsername = Boolean(data?.me?.username)
  const lnAddress = `${data?.me?.username}@${lnAddressHostname}`

  const usernameTitle = hasUsername ? lnAddress : LL.common.blinkUser()

  if (loading) return <Skeleton style={styles.outer} animation="pulse" />

  return (
    <TouchableWithoutFeedback
      onPress={() =>
        !isUserLoggedIn &&
        navigation.reset({
          index: 0,
          routes: [{ name: "getStarted" }],
        })
      }
    >
      <View style={styles.outer}>
        <View style={styles.iconContainer}>
          <NostrAwareAccountIcon size={25} />
        </View>
        <Text type="p2">
          {isUserLoggedIn ? usernameTitle : LL.SettingsScreen.logInOrCreateAccount()}
        </Text>
      </View>
    </TouchableWithoutFeedback>
  )
}

const SelfCustodialAccountBanner: React.FC = () => {
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()
  const { LL } = useI18nContext()
  const { lightningAddress } = useSelfCustodialWallet()
  const { copyToClipboard } = useClipboard()

  if (!lightningAddress) return null

  const handleCopy = () =>
    copyToClipboard({
      content: lightningAddress,
      message: LL.GaloyAddressScreen.copiedLightningAddressToClipboard(),
    })

  return (
    <TouchableOpacity onPress={handleCopy} style={styles.outer}>
      <View style={styles.iconContainer}>
        <NostrAwareAccountIcon size={25} />
      </View>
      <View style={styles.textContainer}>
        <Text type="p2" numberOfLines={1} ellipsizeMode="middle">
          {lightningAddress}
        </Text>
        <Text type="p3" style={styles.subtitle}>
          {LL.SettingsScreen.nonCustodialAccount()}
        </Text>
      </View>
      <GaloyIcon name="copy-paste" size={20} color={colors.primary} />
    </TouchableOpacity>
  )
}

export const AccountIcon: React.FC<{ size: number }> = ({ size }) => {
  const {
    theme: { colors },
  } = useTheme()
  return <GaloyIcon name="user" size={size} backgroundColor={colors.grey4} />
}

/**
 * Account icon with the ACTIVE account's nostr-identity profile photo when one exists
 * (kind-0 `picture`, 2026-08-21) — falls back to the generic placeholder. Inert when the
 * signer flag is off (upstream builds unchanged).
 */
const NostrAwareAccountIcon: React.FC<{ size: number }> = ({ size }) => {
  const { nostrSignerEnabled } = useFeatureFlags()
  const { pubkeyHex } = useNostrIdentity()
  // Re-read when the containing screen regains focus (e.g. returning from the identity hub
  // right after an avatar upload) instead of only on mount.
  const isFocused = useIsFocused()
  const [pictureUrl] = useNostrProfilePicture(
    nostrSignerEnabled ? pubkeyHex : null,
    isFocused,
  )
  if (!pictureUrl) return <AccountIcon size={size} />
  return (
    <Image
      source={{ uri: pictureUrl }}
      style={{ width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }}
    />
  )
}

const useStyles = makeStyles((theme) => ({
  outer: {
    height: 70,
    padding: 4,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  switch: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconContainer: {
    backgroundColor: theme.colors.grey4,
    borderRadius: 100,
    padding: 3,
  },
  textContainer: {
    flex: 1,
    flexDirection: "column",
  },
  subtitle: {
    color: theme.colors.grey2,
  },
}))
