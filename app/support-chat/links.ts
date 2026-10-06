/**
 * Tappable links in support messages (M20, operator 2026-10-06).
 *
 * Only messages from VERIFIED support members are linkified (the caller decides); this
 * module only parses. Two kinds:
 *  - web links: https only, host EXACTLY on the allowlist (github.com additionally needs
 *    the path to start with /blinkbitcoin/) — lookalikes, userinfo, ports, http stay text;
 *  - app links: blink://<path> for the screens in SUPPORT_APP_LINKS only — never a route
 *    that pre-fills a payment (bitcoin:, lightning:, pay.blink.sv/<user> stay out).
 * The relay's output check (bot-v2/drafter.mjs) applies the same lists to drafts.
 */

export const SUPPORT_WEB_HOSTS: Record<string, string | null> = {
  "faq.blink.sv": null,
  "blink.sv": null,
  "www.blink.sv": null,
  "dev.blink.sv": null,
  "blink.statuspage.io": null,
  "github.com": "/blinkbitcoin/", // path prefix required
  // block explorers the app itself links (transaction details) — support shares them to let
  // a customer follow a payment (operator 2026-10-06)
  "mempool.space": null,
  "sparkscan.io": null,
}

/** blink://<path> → the screen it opens (subset of app/navigation/deep-link-screens.ts). */
export type AppLinkTarget = {
  screen: string
  params?: Record<string, unknown>
  label: SupportAppScreen
}
export type SupportAppScreen =
  | "home"
  | "settings"
  | "security"
  | "twoFactor"
  | "email"
  | "account"
  | "limits"
  | "feeRates"
  | "notifications"
  | "language"
  | "displayCurrency"
  | "defaultAccount"
  | "receive"
  | "circles"
  | "earn"
  | "map"
  | "price"
  | "card"
  | "cardLimits"
  | "cardSettings"
  | "cardStatements"

export const SUPPORT_APP_LINKS: Record<string, AppLinkTarget> = {
  "home": { screen: "Primary", params: { screen: "Home" }, label: "home" },
  "settings": { screen: "settings", label: "settings" },
  "settings/security": { screen: "security", label: "security" },
  "settings/2fa": { screen: "totpRegistrationInitiate", label: "twoFactor" },
  "settings/email": { screen: "emailRegistrationInitiate", label: "email" },
  "settings/account": { screen: "accountScreen", label: "account" },
  "settings/tx-limits": { screen: "transactionLimitsScreen", label: "limits" },
  "settings/fee-rates": { screen: "feeRatesScreen", label: "feeRates" },
  "settings/notifications": {
    screen: "notificationSettingsScreen",
    label: "notifications",
  },
  "settings/language": { screen: "language", label: "language" },
  "settings/display-currency": { screen: "currency", label: "displayCurrency" },
  "settings/default-account": { screen: "defaultWallet", label: "defaultAccount" },
  "receive": { screen: "receiveBitcoin", label: "receive" },
  "circles": {
    screen: "Primary",
    params: { screen: "People", params: { screen: "circlesDashboard" } },
    label: "circles",
  },
  "earn": { screen: "Primary", params: { screen: "Earn" }, label: "earn" },
  "map": { screen: "Primary", params: { screen: "Map" }, label: "map" },
  "price": { screen: "priceHistory", label: "price" },
  "card": { screen: "cardDashboardScreen", label: "card" },
  "card/limits": { screen: "cardLimitsScreen", label: "cardLimits" },
  "card/settings": { screen: "cardSettingsScreen", label: "cardSettings" },
  "card/statements": { screen: "cardStatementsScreen", label: "cardStatements" },
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "web"; text: string; url: string }
  | { kind: "app"; text: string; path: string; target: AppLinkTarget }

/** A web URL support may link to, or null. Exact host match on the PARSED url. */
export function allowedWebUrl(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null
  const host = u.hostname.toLowerCase()
  if (!Object.prototype.hasOwnProperty.call(SUPPORT_WEB_HOSTS, host)) return null
  const prefix = SUPPORT_WEB_HOSTS[host]
  if (prefix && !u.pathname.toLowerCase().startsWith(prefix)) return null
  return u.toString()
}

/** The app screen a blink:// link may open, or null. */
export function allowedAppLink(
  raw: string,
): { path: string; target: AppLinkTarget } | null {
  const m = /^blink:\/\/([a-z0-9/-]+?)\/?$/i.exec(raw)
  if (!m) return null
  const path = m[1].toLowerCase()
  const target = SUPPORT_APP_LINKS[path]
  return target ? { path, target } : null
}

// markdown [label](url) or a bare https:// / blink:// token
const TOKEN =
  /\[([^\]\n]{1,120})\]\(((?:https|blink):\/\/[^\s)]+)\)|((?:https|blink):\/\/[^\s<>"'`]+)/gi
// trailing punctuation is prose, not part of the URL (a closing ")" only if unbalanced)
const trimTrailing = (url: string): string => {
  let u = url
  for (;;) {
    const last = u.slice(-1)
    if (/[.,!?:;'"»]/.test(last)) u = u.slice(0, -1)
    else if (
      last === ")" &&
      (u.match(/\(/g) ?? []).length < (u.match(/\)/g) ?? []).length
    )
      u = u.slice(0, -1)
    else return u
  }
}

/** Split a message into text / web-link / app-link segments (unknown links stay text). */
export function splitLinks(text: string): Segment[] {
  const out: Segment[] = []
  const push = (s: Segment) => {
    const prev = out[out.length - 1]
    if (s.kind === "text" && prev?.kind === "text") prev.text += s.text
    else if (s.kind !== "text" || s.text) out.push(s)
  }
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0
    push({ kind: "text", text: text.slice(last, start) })
    const label = m[1]
    const raw = m[2] ?? trimTrailing(m[3])
    const consumed = m[2] ? m[0] : raw
    const app = allowedAppLink(raw)
    const web = app ? null : allowedWebUrl(raw)
    if (app) push({ kind: "app", text: label ?? raw, path: app.path, target: app.target })
    else if (web) push({ kind: "web", text: label ?? raw, url: web })
    else push({ kind: "text", text: label ? `${label} (${raw})` : raw })
    last = start + consumed.length
  }
  push({ kind: "text", text: text.slice(last) })
  return out
}
