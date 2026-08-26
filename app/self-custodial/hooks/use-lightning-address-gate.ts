import { LnurlDomain } from "@app/self-custodial/config"
import { useSelfCustodialAccountMode } from "./use-self-custodial-account-mode"

import { useSelfCustodialLightningAddress } from "@app/screens/settings-screen/settings/use-self-custodial-lightning-address"

/**
 * Whether the account's Lightning address is withheld as a way to get paid.
 *
 * The address is a public identifier a server answers for. Upstream (blink.sv)
 * refuses to mint invoices for an Anon account — the address goes dormant — so an
 * address there must not be offered while incognito. twentyone.ist runs
 * `--allow-anon-addresses` (fork): an address on that domain keeps working in
 * incognito, and creating one is offered there. Every surface that offers or
 * labels the address reads this, so the next reason to withhold it lands here
 * instead of being restated screen by screen.
 */
export const useLightningAddressGated = (): boolean => {
  const { isAnonMode } = useSelfCustodialAccountMode()
  const lightningAddress = useSelfCustodialLightningAddress()

  if (!isAnonMode) return false
  /** Nothing to withhold: the row offers creation, and the choice screen routes
   *  incognito users to the anon-friendly domain. */
  if (!lightningAddress) return false

  const domain = lightningAddress.split("@")[1]?.trim().toLowerCase()
  return domain !== LnurlDomain.TwentyoneIst
}
