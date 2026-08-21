/**
 * One-tap BTCPay magic-link login (POC).
 *
 * Builds the same-device sign-in URL for the managed BTCPay instance: the app signs a kind-27235
 * (NIP-98) event locally — `u` = the plugin's open login endpoint, `method` = GET — and opens
 * the mobile browser to `<endpoint>?event=<base64url(json)>`. The plugin (v0.7.0+) validates the
 * event (signature + URL binding + freshness + replay guard), provisions a store from the
 * `lnaddress` tag when the user is new, and signs the browser session in.
 *
 * POC shortcut (flagged for spec reconciliation): the instance URL is a hardcoded constant —
 * the managed-instance discovery story is deliberately not built yet.
 */

/** POC: the managed BTCPay instance this build targets. */
export const BTCPAY_INSTANCE_URL = "https://btcpay.twentyone.ist"

/** The instance's service image (matches the plugin's advertised `image` param). */
export const BTCPAY_INSTANCE_IMAGE =
  "https://avatars.githubusercontent.com/u/31132886?s=200&v=4"

/** The plugin's open NIP-98 endpoint path (GET form). */
const NIP98_LOGIN_PATH = "/login/nostr/nip98"

/** The absolute URL the signed event's `u` tag binds to (no query — params are not part of it). */
export const btcpayNip98LoginUrl = (): string =>
  `${BTCPAY_INSTANCE_URL}${NIP98_LOGIN_PATH}`

/** Base64url-encode (URL-safe alphabet, unpadded) so the JSON survives a query string verbatim. */
export const toBase64Url = (utf8: string): string =>
  Buffer.from(utf8, "utf-8")
    .toString("base64")
    .replace(/[+]/g, "-")
    .replace(/[/]/g, "_")
    .replace(/[=]+$/, "")

/** Build the magic-link URL carrying a signed event. */
export const buildBtcpayLoginUrl = (signedEvent: unknown): string =>
  `${btcpayNip98LoginUrl()}?event=${toBase64Url(JSON.stringify(signedEvent))}`
