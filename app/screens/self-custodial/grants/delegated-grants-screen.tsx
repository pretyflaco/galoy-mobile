/**
 * Delegated Receive Grants (D2) — LNbits receive-only access (POC).
 *
 * One screen, three steps (state machine, NOT routes): the DRGK private hex must never
 * transit navigation params or storage, so the success view renders from memory here.
 *  - list:    active delegations (fingerprint / expiry countdown / Revoke)
 *  - create:  fresh CSPRNG DRGK + expiry choice + plain-language approval panel
 *  - success: one-time display of the DRGK private key (QR + copy, auto-clear, screen
 *             security) with paste-into-LNbits instructions
 *
 * Signing uses the Spark IDENTITY key via the bridge seam (sdk.signMessage DER); the nsec
 * signer stack is deliberately NOT involved (wrong key, wrong curve form).
 */
import React, { useCallback, useEffect, useState } from "react"
import { ScrollView, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { GaloyErrorBox } from "@app/components/atomic/galoy-error-box"
import { QrCodeComponent } from "@app/components/totp-export/totp-qr"
import { useFeatureFlags } from "@app/config/feature-flags-context"
import { useClipboard } from "@app/hooks"
import { useScreenSecurity } from "@app/hooks/use-screen-security"
import { useI18nContext } from "@app/i18n/i18n-react"
import {
  createDelegatedGrant,
  GrantApiError,
  MAX_GRANT_EXPIRY_SECS,
  revokeDelegatedGrant,
  type GrantRecord,
} from "@app/self-custodial/grants/grant-api"
import {
  grantFingerprint,
  loadGrants,
  removeGrant,
  saveGrant,
} from "@app/self-custodial/grants/grant-store"
import { generateDrgkKeypair } from "@app/nostr/core/keygen"
import { useNostrAccountMode } from "@app/nostr/use-nostr-account-key"
import { signMessageWithIdentityKey } from "@app/self-custodial/bridge"
import { grantServerForAddress } from "@app/self-custodial/grants/server"
import { useSelfCustodialWallet } from "@app/self-custodial/providers/wallet"
import { useSelfCustodialLightningAddress } from "@app/screens/settings-screen/settings/use-self-custodial-lightning-address"
import { Screen } from "@app/components/screen"
import { testProps } from "@app/utils/testProps"

const DAY_SECS = 24 * 60 * 60
/** Default delegation lifetime (feature-request proposal) and the picker choices. */
const DEFAULT_EXPIRY_DAYS = 90
const EXPIRY_CHOICES_DAYS = [90, 180, 365] as const
const CLIPBOARD_CLEAR_MS = 60_000

type Step = "list" | "create" | "success"

interface FreshKeypair {
  privKeyHex: string
  compressedPubKeyHex: string
}

export const DelegatedGrantsScreen: React.FC = () => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.DelegatedGrantsScreen
  const { delegatedGrantsEnabled } = useFeatureFlags()
  const { isSelfCustodial, accountKey } = useNostrAccountMode()
  const wallet = useSelfCustodialWalletSafe()

  const [step, setStep] = useState<Step>("list")
  const [grants, setGrants] = useState<GrantRecord[]>([])
  const [expiryDays, setExpiryDays] = useState<number>(DEFAULT_EXPIRY_DAYS)
  const [keypair, setKeypair] = useState<FreshKeypair | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorKind, setErrorKind] = useState<string | null>(null)

  // Defensive re-check of the entry-point gates (settings row already gates both).
  useEffect(() => {
    if (!delegatedGrantsEnabled || !isSelfCustodial || !wallet.enabled) return
    loadGrants(accountKey).then(setGrants)
  }, [delegatedGrantsEnabled, isSelfCustodial, accountKey, wallet.enabled])

  useEffect(() => {
    if (!wallet.lightningAddress && step !== "list") setStep("list")
  }, [wallet.lightningAddress, step])

  const startCreate = useCallback(() => {
    setErrorKind(null)
    // Fresh random key per delegation — NEVER derived from the Spark seed (AC-3);
    // independent rotation/revocation requires seed-independence.
    setKeypair(generateDrgkKeypair())
    setStep("create")
  }, [])

  const confirmCreate = useCallback(async () => {
    if (!keypair || !wallet.sdk || !wallet.lightningAddress) return
    setBusy(true)
    setErrorKind(null)
    try {
      const record = await createDelegatedGrant({
        base: grantServerForAddress(wallet.lightningAddress),
        lightningAddress: wallet.lightningAddress,
        delegatedPubkey: keypair.compressedPubKeyHex,
        expirySecs: expiryDays * DAY_SECS,
        signGrantMessage: (message) => signMessageWithIdentityKey(wallet.sdk!, message),
      })
      await saveGrant(accountKey, record)
      setGrants((prev) => [record, ...prev])
      setStep("success")
    } catch (err) {
      setErrorKind(err instanceof GrantApiError ? err.kind : "generic")
    } finally {
      setBusy(false)
    }
  }, [keypair, wallet.sdk, wallet.lightningAddress, expiryDays, accountKey])

  const revoke = useCallback(
    async (record: GrantRecord) => {
      if (!wallet.sdk) return
      setBusy(true)
      setErrorKind(null)
      try {
        await revokeDelegatedGrant({
          base: grantServerForAddress(record.lightningAddress),
          ownerPubkey: record.ownerPubkey,
          delegatedPubkey: record.delegatedPubkey,
          signGrantMessage: (message) => signMessageWithIdentityKey(wallet.sdk!, message),
        }).catch((err) => {
          // A 404 means the grant is already gone server-side — treat as revoked.
          if (err instanceof GrantApiError && err.kind === "not-found") return
          throw err
        })
        await removeGrant(accountKey, record.delegatedPubkey)
        setGrants((prev) =>
          prev.filter((g) => g.delegatedPubkey !== record.delegatedPubkey),
        )
      } catch (err) {
        setErrorKind(err instanceof GrantApiError ? err.kind : "generic")
      } finally {
        setBusy(false)
      }
    },
    [wallet.sdk, accountKey],
  )

  const finishSuccess = useCallback(() => {
    // Drop the private hex from memory as soon as the user leaves the success view.
    setKeypair(null)
    setStep("list")
  }, [])

  if (!delegatedGrantsEnabled || !isSelfCustodial || !wallet.enabled) {
    return (
      <Screen>
        <View style={styles.container}>
          <GaloyErrorBox errorMessage={T.errorUnavailable()} />
        </View>
      </Screen>
    )
  }

  if (step === "success" && keypair) {
    return (
      <GrantSuccessScreen
        privKeyHex={keypair.privKeyHex}
        fingerprint={grantFingerprint(keypair.compressedPubKeyHex)}
        lightningAddress={wallet.lightningAddress ?? ""}
        expiryDate={new Date(Date.now() + expiryDays * DAY_SECS * 1000)}
        onDone={finishSuccess}
      />
    )
  }

  if (step === "create" && keypair) {
    const expiryDate = new Date(Date.now() + expiryDays * DAY_SECS * 1000)
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.container}>
          <Text type="h1" style={styles.title}>
            {T.createTitle()}
          </Text>
          <Text type="p1" style={styles.body}>
            {T.capabilityNotice({
              address: wallet.lightningAddress ?? "",
              date: expiryDate.toLocaleDateString(),
            })}
          </Text>

          <View style={styles.detailBox}>
            <Text type="p2" style={styles.detailLabel}>
              {T.fingerprintLabel()}
            </Text>
            <Text type="p2" style={styles.mono}>
              {grantFingerprint(keypair.compressedPubKeyHex)}
            </Text>
            <Text type="p2" style={styles.detailLabel}>
              {T.expiryLabel()}
            </Text>
          </View>

          <View style={styles.expiryRow}>
            {EXPIRY_CHOICES_DAYS.map((days) => (
              <GaloySecondaryButton
                key={days}
                title={T.expiryOption({ days })}
                onPress={() => setExpiryDays(days)}
                disabled={days * DAY_SECS > MAX_GRANT_EXPIRY_SECS}
                {...(days === expiryDays ? testProps("grant-expiry-selected") : {})}
              />
            ))}
          </View>

          {errorKind ? <GaloyErrorBox errorMessage={errorText(T, errorKind)} /> : null}

          <View style={styles.actions}>
            <GaloyPrimaryButton
              title={busy ? T.creating() : T.confirmCta()}
              loading={busy}
              disabled={busy}
              onPress={confirmCreate}
              {...testProps("grant-confirm")}
            />
            <GaloySecondaryButton
              title={T.cancel()}
              onPress={() => {
                setKeypair(null)
                setStep("list")
              }}
              disabled={busy}
              {...testProps("grant-cancel")}
            />
          </View>
        </ScrollView>
      </Screen>
    )
  }

  // step === "list"
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text type="h1" style={styles.title}>
          {T.title()}
        </Text>
        {wallet.lightningAddress === null ? (
          <GaloyErrorBox errorMessage={T.errorNoAddress()} />
        ) : null}
        {errorKind ? <GaloyErrorBox errorMessage={errorText(T, errorKind)} /> : null}

        {grants.length === 0 ? (
          <Text type="p1" style={styles.body}>
            {T.listEmpty()}
          </Text>
        ) : (
          grants.map((grant) => {
            const daysLeft = Math.max(
              0,
              Math.ceil((grant.expiresAtSecs * 1000 - Date.now()) / (DAY_SECS * 1000)),
            )
            return (
              <View key={grant.delegatedPubkey} style={styles.grantRow}>
                <View style={styles.grantInfo}>
                  <Text type="p2" style={styles.mono}>
                    {grantFingerprint(grant.delegatedPubkey)}
                  </Text>
                  <Text type="p3" style={styles.body}>
                    {T.expiresInDays({ days: daysLeft })}
                  </Text>
                </View>
                <GaloySecondaryButton
                  title={T.revoke()}
                  onPress={() => revoke(grant)}
                  disabled={busy}
                  {...testProps("grant-revoke")}
                />
              </View>
            )
          })
        )}

        <View style={styles.actions}>
          <GaloyPrimaryButton
            title={T.newGrant()}
            onPress={startCreate}
            disabled={!wallet.lightningAddress}
            {...testProps("grant-new")}
          />
        </View>
      </ScrollView>
    </Screen>
  )
}

const GrantSuccessScreen: React.FC<{
  privKeyHex: string
  fingerprint: string
  lightningAddress: string
  expiryDate: Date
  onDone: () => void
}> = ({ privKeyHex, fingerprint, lightningAddress, expiryDate, onDone }) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.DelegatedGrantsScreen
  // AC-6: exclude from screenshots/app-switcher previews, mirror backup-phrase screens.
  // The success view is its own component, so this guards exactly the secret step.
  useScreenSecurity()
  // AC-6: clipboard auto-clears after 60s and on unmount (useClipboard).
  const { copyToClipboard } = useClipboard(CLIPBOARD_CLEAR_MS)

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text type="h1" style={styles.title}>
          {T.successTitle()}
        </Text>
        <Text type="p1" style={styles.body}>
          {T.successBody({
            address: lightningAddress,
            date: expiryDate.toLocaleDateString(),
          })}
        </Text>

        <QrCodeComponent value={privKeyHex} />

        <View style={styles.detailBox}>
          <Text type="p2" style={styles.detailLabel}>
            {T.keyLabel({ fingerprint })}
          </Text>
          <Text type="p2" style={[styles.mono, styles.secret]} selectable>
            {privKeyHex}
          </Text>
        </View>

        <Text type="p2" style={styles.body}>
          {T.instructions()}
        </Text>

        <View style={styles.actions}>
          <GaloyPrimaryButton
            title={T.copyKey()}
            onPress={() =>
              copyToClipboard({ content: privKeyHex, message: T.copiedToast() })
            }
            {...testProps("grant-copy-key")}
          />
          <GaloySecondaryButton
            title={T.done()}
            onPress={onDone}
            {...testProps("grant-done")}
          />
        </View>
      </ScrollView>
    </Screen>
  )
}

const errorText = (
  T: ReturnType<typeof useI18nContext>["LL"]["DelegatedGrantsScreen"],
  kind: string,
): string => {
  switch (kind) {
    case "rate-limit":
      return T.errorRateLimit()
    case "conflict":
      return T.errorConflict()
    case "invalid-expiry":
      return T.errorInvalidExpiry()
    case "identity-key-delegation":
    case "invalid-pubkey":
      return T.errorInvalidKey()
    case "invalid-signature":
      return T.errorSignature()
    case "not-found":
      return T.errorUnsupportedServer()
    default:
      return T.errorNetwork()
  }
}

/**
 * Narrowed view of the wallet state: the grants flow needs the connected sdk plus the
 * resolved lightning address. The address uses the SAME resolution as the settings row
 * (live SDK value, falling back to the domain-matched persisted account-index entry) —
 * the SDK can lose its local address record across a restart while the registration and
 * the persisted entry stay valid, and a live-only read wrongly reports "no address set".
 * `enabled=false` until the self-custodial provider has a live session, which doubles as
 * the AC-7 custodial guard (the context default is inert, so a custodial session never
 * sees live grant state).
 */
const useSelfCustodialWalletSafe = (): {
  enabled: boolean
  sdk: import("@breeztech/breez-sdk-spark-react-native").BreezSdkInterface | null
  lightningAddress: string | null
} => {
  const wallet = useSelfCustodialWallet()
  const lightningAddress = useSelfCustodialLightningAddress()
  return {
    enabled: Boolean(wallet.sdk),
    sdk: wallet.sdk,
    lightningAddress,
  }
}

const useStyles = makeStyles(({ colors }) => ({
  container: { padding: 24, rowGap: 16 },
  title: { color: colors.grey0 },
  body: { color: colors.grey1 },
  detailBox: { backgroundColor: colors.grey5, borderRadius: 8, padding: 12, rowGap: 6 },
  detailLabel: { color: colors.grey1, fontWeight: "bold" },
  mono: { color: colors.grey0, fontFamily: "monospace" },
  secret: { fontSize: 12, wordBreak: "break-all" as never },
  expiryRow: { flexDirection: "row", justifyContent: "space-between", columnGap: 8 },
  grantRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.grey5,
    borderRadius: 8,
    padding: 12,
  },
  grantInfo: { rowGap: 4, flexShrink: 1 },
  actions: { marginTop: 12, rowGap: 12 },
}))
