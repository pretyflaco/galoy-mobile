/**
 * Hermes URL polyfill guards — support chat (P1, from poc/support-chat-demo M6 + M9).
 *
 * marmot-ts validates relay URLs with `URL.canParse` (missing on Hermes, M2) and —
 * on v2 (master 0.6.0) — its nostr-routing component decoder also validates relays
 * with `new URL(u).hostname`, which RN's built-in URL leaves empty for wss://
 * (F-M9-10). app/app.tsx imports `react-native-url-polyfill/auto`, which REPLACES
 * the global URL after index.js ran (F-M6-3) — so this module first (re-)installs
 * that full URL implementation, then adds `canParse` if still absent. Idempotent,
 * non-clobbering; imported from index.js (before any consumer) and re-runnable via
 * ensureUrlCanParse() when the chat starts.
 */
import "react-native-url-polyfill/auto"

type UrlWithCanParse = typeof URL & { canParse?: (url: string, base?: string) => boolean }

export const ensureUrlCanParse = (): void => {
  const U = globalThis.URL as UrlWithCanParse | undefined
  if (!U || typeof U.canParse === "function") return
  U.canParse = (url: string, base?: string) => {
    try {
      // eslint-disable-next-line no-new
      new U(url, base)
      return true
    } catch {
      return false
    }
  }
}

ensureUrlCanParse()
