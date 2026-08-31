import { useSelfCustodialAccountMode } from "./use-self-custodial-account-mode"
import { useAccountLightningAddresses } from "./use-account-lightning-addresses"

/**
 * Whether the account's Lightning address is withheld as a way to get paid.
 *
 * The address is a public identifier a server answers for. Upstream (blink.sv)
 * refuses to mint invoices for an Anon account — the address goes dormant — so an
 * address there must not be offered while incognito. twentyone.ist runs
 * `--allow-anon-addresses` (fork): an address on that domain keeps working in
 * incognito, and creating one is offered there. An account can hold addresses on
 * BOTH domains (primary + alt slot); any twentyone.ist one lifts the gate.
 * Every surface that offers or labels the address reads this, so the next reason
 * to withhold it lands here instead of being restated screen by screen.
 */
export const useLightningAddressGated = (): boolean => {
  const { isAnonMode } = useSelfCustodialAccountMode()
  const { primary, alt, twentyoneIstAddress } = useAccountLightningAddresses()

  if (!isAnonMode) return false
  /** A twentyone.ist address — in either slot — stays live in Incognito. */
  if (twentyoneIstAddress) return false
  /** Nothing to withhold: the row offers creation, and the choice screen routes
   *  incognito users to the anon-friendly domain. */
  if (!primary && !alt) return false

  /** Only blink.sv (or a regtest-staging) address exists: dormant upstream. */
  return true
}
