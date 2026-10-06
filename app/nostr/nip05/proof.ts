/**
 * NIP-05 proof event (POC) — pure template builder.
 *
 * Registration at the lnurl server requires proof that the caller CONTROLS the nostr
 * key they want the handle bound to: a kind-22242 (client authentication) event,
 * signed by that key, carrying a single `lnaddress` tag equal to the handle being
 * claimed. Without this a user could bind someone else's established nostr pubkey to
 * their own username — a verified impersonation.
 *
 * The template is signed through the runtime's self-signing seam (`signAuthEvent`):
 * unlike the NIP-46 client-driven flow (which normalizes lnaddress tags from the
 * signer's own notion of the account address), the self-signing seam signs tags
 * verbatim — so the exact handle under registration is what gets signed.
 */
import { LNADDRESS_TAG } from "@app/nostr/core/lightning-address"

/** Kind 22242 — NIP-42 client authentication; the lnurl server also accepts 27235. */
export const NIP05_PROOF_KIND = 22242

/**
 * The unsigned proof template for `lnaddress` (e.g. `alice@blink.sv`). `now` is
 * injected for deterministic tests; the server rejects proofs older than 10 minutes.
 */
export const buildNip05ProofTemplate = (
  lnaddress: string,
  now: () => number = () => Math.floor(Date.now() / 1000),
) => ({
  kind: NIP05_PROOF_KIND,
  // eslint-disable-next-line camelcase
  created_at: now(),
  tags: [[LNADDRESS_TAG, lnaddress]],
  content: "",
})
