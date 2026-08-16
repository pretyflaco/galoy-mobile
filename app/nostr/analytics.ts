/**
 * Signer analytics — ceremony funnel events (SM-5), metadata-only (AD-7 / NFR-3).
 *
 * These events carry NO key material, NO npub, NO plaintext/content — only the funnel
 * step. They fire through the app's existing Firebase analytics substrate, matching the
 * `logEvent(name, payload)` pattern in app/utils/analytics.ts.
 */
import analytics from "@react-native-firebase/analytics"

/** Fired when the user starts the creation ceremony (intro CTA). */
export const logNostrIdentityCeremonyStarted = (): void => {
  analytics().logEvent("nostr_identity_ceremony_started")
}

/** Fired when the ceremony completes (identity committed). Metadata-only — no npub. */
export const logNostrIdentityCeremonyCompleted = (): void => {
  analytics().logEvent("nostr_identity_ceremony_completed")
}
