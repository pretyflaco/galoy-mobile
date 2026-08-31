import { Network } from "@breeztech/breez-sdk-spark-react-native"
import Config from "react-native-config"
import { DocumentDirectoryPath } from "react-native-fs"

import { LNURL_DOMAINS } from "@app/config/appinfo"
import { type GaloyInstanceName } from "@app/config/galoy-instances"

export const SparkToken = {
  Label: "USDB",
  DefaultDecimals: 6,
} as const

export type SparkToken = (typeof SparkToken)[keyof typeof SparkToken]

export const MAX_SLIPPAGE_BPS = 50

// Spark bech32 HRPs (spark1/sparkrt1); gates the async sdk.parse, which can hang on some non-Spark bech32 input.
const SPARK_ADDRESS_SHAPE_PATTERN = /^(?:spark1|sparkrt1)/i

export const hasSparkAddressShape = (input: string): boolean =>
  SPARK_ADDRESS_SHAPE_PATTERN.test(input.trim())

export type SparkNetworkLabel = "mainnet" | "regtest"

/**
 * Self-custodial follows the same environment mapping as custodial. Breez only
 * supports mainnet and regtest, so every non-Main instance maps to regtest.
 */
export const networkForInstance = (instanceId: GaloyInstanceName): Network =>
  instanceId === "Main" ? Network.Mainnet : Network.Regtest

export const networkLabelFor = (network: Network): SparkNetworkLabel =>
  network === Network.Mainnet ? "mainnet" : "regtest"

export const isRegtestNetwork = (network: Network): boolean => network === Network.Regtest

/**
 * Mainnet Lightning Address (LNURL) domains a self-custodial account can be registered
 * on. The choice is fixed per account once its address exists (the SDK's `lnurlDomain` is
 * set at connect time, so an account binds to one server). `BlinkSv` is the production
 * default; `TwentyoneIst` is the blink-lnurl-server fork that implements delegated grants
 * (D1/D2) and is gated behind the delegatedGrantsEnabled feature flag.
 *
 * ponytail: multiple `@twentyone.ist` aliases for a fee is a deferred epic — it needs
 * lnurl-server multi-username support, a fee-payment flow, and alias-management UI.
 */
export const LnurlDomain = {
  BlinkSv: "blink.sv",
  TwentyoneIst: "twentyone.ist",
} as const

export type LnurlDomain = (typeof LnurlDomain)[keyof typeof LnurlDomain]

export const isMainnetLnurlDomain = (value: unknown): value is LnurlDomain =>
  value === LnurlDomain.BlinkSv || value === LnurlDomain.TwentyoneIst

/** Production default — the standard Blink domain. */
export const DEFAULT_MAINNET_LNURL_DOMAIN: LnurlDomain = LnurlDomain.BlinkSv

const REGTEST_LNURL_DOMAIN = "staging.blink.sv"

/**
 * The LNURL domain for a self-custodial account. `choice` is the account's stored domain
 * (fixed at registration); null/undefined — or a regtest network — falls back to the
 * default, so accounts created before domain selection shipped keep their blink.sv
 * address.
 */
export const lnurlDomainFor = (network: Network, choice?: LnurlDomain | null): string =>
  network === Network.Mainnet
    ? choice ?? DEFAULT_MAINNET_LNURL_DOMAIN
    : REGTEST_LNURL_DOMAIN

const REGTEST_PAY_DOMAIN = "pay.staging.blink.sv"

/**
 * Every host that serves one of our own accounts on this network, the address domain
 * first: the point of sale answers on `pay.*` while an account is spelled without it.
 * Kept per network because a host belongs to the deployment that serves it, and
 * declaring another one's would name an account this network never issued.
 */
export const lnurlDomainsFor = (network: Network): string[] =>
  network === Network.Mainnet
    ? LNURL_DOMAINS
    : [lnurlDomainFor(network), REGTEST_PAY_DOMAIN]

/**
 * Base URL of the LNURL server for a self-custodial account: the same host its address is
 * spelled with, which is what serves the authenticated `/lnurlpay/{pubkey}` routes. Not
 * the custodial `lnAddressHostname` — `pay.*` fronts the payment app and 404s them.
 */
export const lnurlServerUrlFor = (
  network: Network,
  choice?: LnurlDomain | null,
): string => `https://${lnurlDomainFor(network, choice)}`

/**
 * Returns the wallet's stored network label when it conflicts with the current
 * network, or null when there is no stored label or it matches. Single source
 * of the mismatch rule shared by the SDK connect gate and the mismatch toast.
 */
export const mismatchedNetworkLabel = (
  storedLabel: string | null,
  network: Network,
): string | null => {
  if (!storedLabel) return null
  return storedLabel === networkLabelFor(network) ? null : storedLabel
}

export const storageDirFor = (accountId: string, network: Network): string =>
  `${DocumentDirectoryPath}/breez-sdk-spark-${networkLabelFor(network)}/${accountId}`

// Validates BREEZ_API_KEY at SDK init (from `lifecycle.createSdkConfig`). A
// missing key means the build is misconfigured (e.g. release minification
// stripped the react-native-config BuildConfig values); failing loud here
// surfaces that instead of connecting with an empty key and showing a
// misleading "wallet is offline" network error.
export const requireBreezApiKey = (): string => {
  const apiKey = Config.BREEZ_API_KEY
  if (!apiKey) {
    throw new Error("BREEZ_API_KEY is not configured for this build")
  }
  return apiKey
}

let cachedTokenIdentifier: string | null = null

// Validates SPARK_TOKEN_IDENTIFIER once per session. The first call (typically
// from `lifecycle.createSdkConfig` at SDK init) performs the env lookup and
// throws on a misconfigured build; downstream callers in hot paths (mappers,
// snapshot loops, conversion entry points) read the cached value without
// re-validating.
export const requireSparkTokenIdentifier = (): string => {
  if (cachedTokenIdentifier !== null) return cachedTokenIdentifier
  const id = Config.SPARK_TOKEN_IDENTIFIER
  if (!id) {
    throw new Error("SPARK_TOKEN_IDENTIFIER is not configured for this build")
  }
  cachedTokenIdentifier = id
  return id
}
