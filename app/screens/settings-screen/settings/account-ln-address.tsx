import React, { useState } from "react"
import { useTheme } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { BackupRequiredModal } from "@app/components/backup-required-modal"
import { SetLightningAddressModal } from "@app/components/set-lightning-address-modal"
import { useSettingsScreenQuery } from "@app/graphql/generated"
import { useIsAuthed } from "@app/graphql/is-authed-context"
import { useAppConfig, useClipboard } from "@app/hooks"
import { useAccountRegistry } from "@app/hooks/use-account-registry"
import { useI18nContext } from "@app/i18n/i18n-react"
import { RootStackParamList } from "@app/navigation/stack-param-lists"
import { useAccountLightningAddresses } from "@app/self-custodial/hooks/use-account-lightning-addresses"
import { useLightningAddressGated } from "@app/self-custodial/hooks/use-lightning-address-gate"
import { useSelfCustodialAccountMode } from "@app/self-custodial/hooks/use-self-custodial-account-mode"
import { useNavigation } from "@react-navigation/native"
import { NativeStackNavigationProp } from "@react-navigation/native-stack"
import { BackupStatus, useBackupState } from "@app/self-custodial/providers/backup-state"
import { AccountType } from "@app/types/wallet"
import { getLightningAddress } from "@app/utils/pay-links"

import { SettingsRow } from "../row"

const SUBTITLE_SHORTER_LENGTH = 22

export const AccountLNAddress: React.FC = () => {
  const { activeAccount } = useAccountRegistry()

  if (activeAccount?.type === AccountType.SelfCustodial) {
    return <SelfCustodialLightningAddressRow />
  }
  return <CustodialLightningAddressRow />
}

type LightningAddressRowProps = {
  address: string | null
  loading?: boolean
  /** Marks the address as unusable: the row says so and drops the copy affordance,
   *  while `address` stays the bare address so nothing can copy the label. */
  isDisabled?: boolean
  /** What a tap on the DISABLED row does. Unset = inert (custodial default); the
   *  self-custodial row uses it to route a withheld blink.sv address into registering
   *  the mode-usable one. */
  onDisabledAction?: () => void
  /** Second line — the account's other-domain address when it holds both. */
  subtitle?: string
  /** When set, creating an address navigates (self-custodial's two-screen flow) instead of
   *  opening the modal. Custodial leaves this undefined and keeps the modal. */
  onCreateAddress?: () => void
  renderModal: (modal: { isVisible: boolean; toggleModal: () => void }) => React.ReactNode
}

const LightningAddressRow: React.FC<LightningAddressRowProps> = ({
  address,
  loading,
  isDisabled = false,
  onDisabledAction,
  subtitle,
  onCreateAddress,
  renderModal,
}) => {
  const {
    theme: { colors },
  } = useTheme()
  const { LL } = useI18nContext()
  const { copyToClipboard } = useClipboard()
  const [isModalShown, setModalShown] = useState(false)
  const toggleModal = () => setModalShown((shown) => !shown)

  const copyAddress = (value: string) =>
    copyToClipboard({
      content: value,
      message: LL.GaloyAddressScreen.copiedLightningAddressToClipboard(),
    })

  const isAddressCopyable = Boolean(address) && !isDisabled
  const disabledSuffix = isDisabled ? ` ${LL.SettingsScreen.addressDisabled()}` : ""
  const displayedTitle = address
    ? `${address}${disabledSuffix}`
    : LL.SettingsScreen.createAddress()

  /** A disabled address never copies: the label is not an address, so copying it would
   *  hand the user a string no wallet can pay. When the disable has a remedy the row
   *  routes there (onDisabledAction); otherwise it is inert. Otherwise the row creates
   *  an address or copies it. */
  const handleAction = () => {
    if (isDisabled) {
      onDisabledAction?.()
      return
    }
    if (!address) {
      if (onCreateAddress) {
        onCreateAddress()
      } else {
        toggleModal()
      }
      return
    }
    copyAddress(address)
  }

  return (
    <>
      <SettingsRow
        loading={loading}
        title={displayedTitle}
        subtitle={subtitle}
        subtitleShorter={
          subtitle
            ? subtitle.length > SUBTITLE_SHORTER_LENGTH
            : displayedTitle.length > SUBTITLE_SHORTER_LENGTH
        }
        leftGaloyIcon="lightning-address"
        rightIcon={
          isAddressCopyable ? (
            <GaloyIcon name="copy-paste" size={20} color={colors.primary} />
          ) : undefined
        }
        action={handleAction}
      />
      {renderModal({ isVisible: isModalShown, toggleModal })}
    </>
  )
}

const CustodialLightningAddressRow: React.FC = () => {
  const { appConfig } = useAppConfig()
  const isAuthed = useIsAuthed()
  const { data, loading } = useSettingsScreenQuery({ skip: !isAuthed })

  const username = data?.me?.username
  const address = username
    ? getLightningAddress(appConfig.galoyInstance.lnAddressHostname, username)
    : null

  return (
    <LightningAddressRow
      address={address}
      loading={loading}
      renderModal={({ isVisible, toggleModal }) => (
        <SetLightningAddressModal isVisible={isVisible} toggleModal={toggleModal} />
      )}
    />
  )
}

const SelfCustodialLightningAddressRow: React.FC = () => {
  const { LL } = useI18nContext()
  const { primary, alt, effective } = useAccountLightningAddresses()
  const { isAnonMode } = useSelfCustodialAccountMode()
  const { backupState } = useBackupState()
  const isLightningAddressGated = useLightningAddressGated()
  const isBackupRequired = backupState.status !== BackupStatus.Completed
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  /** What the main line shows: the mode-usable address when one exists; otherwise the
   *  withheld one (Incognito with only a blink.sv address) so the user sees what they
   *  have; otherwise the create prompt. */
  const address = effective ?? primary ?? alt
  const isDisabled = isLightningAddressGated && Boolean(address)

  /** The other-domain address rides as the subtitle when the account holds both. In
   *  Incognito that second line is the dormant blink.sv one, so it says so. */
  const other = address === primary ? alt : primary
  const showBoth = Boolean(primary && alt && other)
  const subtitle = showBoth
    ? `${other}${isAnonMode ? ` ${LL.SettingsScreen.addressDisabled()}` : ""}`
    : undefined

  /** Incognito with only a blink.sv address: the tap is the way OUT — register the
   *  mode-usable twentyone.ist address (secondary flow; the SDK stays on blink.sv). */
  const handleDisabledTap = () => navigation.navigate("selfCustodialChooseLnurlDomain")

  /** Registration is a two-screen flow (domain choice, then username) rather than the old
   *  modal, because the domain is a fixed per-account decision. Only entered when no
   *  address exists yet. While backup is incomplete, `onCreateAddress` is withheld so the
   *  row falls into the modal path, which renders the backup-required prompt instead of
   *  navigating. */
  return (
    <LightningAddressRow
      address={address}
      /** Incognito cannot receive on a blink.sv-only account: the row says so next to
       *  the address it still shows, and the tap offers the twentyone.ist remedy. */
      isDisabled={isDisabled}
      onDisabledAction={isDisabled ? handleDisabledTap : undefined}
      subtitle={subtitle}
      onCreateAddress={
        isBackupRequired
          ? undefined
          : () => navigation.navigate("selfCustodialChooseLnurlDomain")
      }
      renderModal={({ isVisible, toggleModal }) =>
        isBackupRequired ? (
          <BackupRequiredModal isVisible={isVisible} onClose={toggleModal} />
        ) : null
      }
    />
  )
}
