/**
 * Per-account scoping for the nostr signer (2026-08-20, supersedes the v1 global slot).
 *
 * Every Blink account — each signed-in custodial profile AND each self-custodial account —
 * gets its OWN nostr identity. The scoping key is:
 *  - self-custodial: the account-index entry id;
 *  - custodial: the selected session profile's backend `accountId`.
 *
 * The key scopes BOTH the secret (keychain service `nostr.nsec.<key>`) and the signer's
 * AsyncStorage state (connections / activity / request ledger / npub outbox, keys suffixed
 * `.<key>`). Scoping connections is not cosmetic: a NIP-46 client connected under account A's
 * npub must never be served signatures from account B's key.
 *
 * A null key means "account not resolvable yet" (the custodial backend accountId is transiently
 * missing right after account creation). Callers must treat null as INERT (empty reads, dropped
 * writes, identity creation gated) — never fall back to a shared slot.
 *
 * POC decision (2026-08-20): NO migration of the legacy global `nostr.nsec` slot
 * (`NOSTR_NSEC_SERVICE` in keystore.ts) — POC installs start from an empty identity hub;
 * the legacy slot is abandoned unread (GA cleanup item: delete it). AD-1: core is UI-free.
 */

/** The per-account keychain service for the identity nsec. */
export const nostrNsecService = (accountKey: string): string => `nostr.nsec.${accountKey}`

/**
 * Scope an AsyncStorage key to an account. Returns null when the account is unresolvable —
 * callers must treat that as inert (null reads, dropped writes), never as a shared namespace.
 */
export const scopedStorageKey = (
  base: string,
  accountKey: string | null,
): string | null => (accountKey ? `${base}.${accountKey}` : null)
