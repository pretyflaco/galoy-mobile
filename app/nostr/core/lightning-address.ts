/**
 * lnaddress tag — one-click BTCPay setup (POC).
 *
 * The signer advertises the user's Blink lightning address on signed LOGIN events (NIP-98
 * kind 27235 + legacy kind 22242 challenge) so a supporting BTCPay instance (nostr-login
 * plugin v0.6.0+) can auto-provision a store wired receive-only to that address
 * (`type=blink;ln-address=...;`). Unknown tags are ignored by other verifiers (NIP-01), so
 * this is additive and safe against vezir and generic NIP-98 clients.
 *
 * Deliberately NOT added to any other kind: the address is only meaningful to a login
 * verifier, and general-purpose signings (notes, zaps, …) must not leak it.
 */

/** Tag identifier read by the BTCPay plugin's provisioning path. */
export const LNADDRESS_TAG = "lnaddress"

/** Login-challenge kinds that may carry the lnaddress tag. */
const LOGIN_TAG_KINDS = new Set([27235, 22242])

// Same strict whitelist as the plugin side: the value is embedded verbatim into a
// `type=blink` connection string, so `;` and `=` must never pass.
const LN_ADDRESS_PATTERN = /^[a-z0-9._-]{1,64}(@[a-z0-9.-]{1,190}\.[a-z]{2,})?$/i

/** Bare usernames resolve against the Blink default domain (mirrors the plugin). */
const DEFAULT_LN_DOMAIN = "blink.sv"

/**
 * Validate + normalize a lightning address for embedding (lowercase; bare username gets the
 * default domain). Returns undefined for anything malformed — fail-open: no tag, no breakage.
 */
export const normalizeLightningAddress = (
  raw: string | undefined | null,
): string | undefined => {
  const trimmed = raw?.trim()
  if (!trimmed || trimmed.length > 254) return undefined
  const lower = trimmed.toLowerCase()
  if (!LN_ADDRESS_PATTERN.test(lower)) return undefined
  return lower.includes("@") ? lower : `${lower}@${DEFAULT_LN_DOMAIN}`
}

/**
 * Append the lnaddress tag for login kinds when an address is available. Idempotent: an
 * existing lnaddress tag (client-supplied) is REPLACED — the client is untrusted, and the
 * signer is the authority on the user's own address.
 */
export const withLightningAddressTag = (
  tags: string[][],
  kind: number,
  lightningAddress: string | undefined,
): string[][] => {
  const normalized = normalizeLightningAddress(lightningAddress)
  if (!LOGIN_TAG_KINDS.has(kind)) return tags
  const without = tags.filter((t) => t[0] !== LNADDRESS_TAG)
  if (!normalized) return without
  return [...without, [LNADDRESS_TAG, normalized]]
}
