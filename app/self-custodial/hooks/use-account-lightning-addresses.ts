import { useAccountRegistry } from "@app/hooks/use-account-registry"
import { useSelfCustodialLightningAddress } from "@app/screens/settings-screen/settings/use-self-custodial-lightning-address"
import { LnurlDomain } from "@app/self-custodial/config"

import { useSelfCustodialAccountMode } from "./use-self-custodial-account-mode"

const domainOf = (address: string): string | undefined =>
  address.split("@")[1]?.trim().toLowerCase()

export type AccountLightningAddresses = {
  /** The SDK-known address on the account's primary domain (null when none). */
  primary: string | null
  /** The REST-registered address on the other mainnet domain (null when none). */
  alt: string | null
  /** The account's blink.sv address from whichever slot holds it (null when none). */
  blinkSvAddress: string | null
  /** The account's twentyone.ist address from whichever slot holds it (null when none). */
  twentyoneIstAddress: string | null
  /**
   * The address that actually works in the current mode. Incognito answers only on
   * twentyone.ist (upstream dormancy withholds blink.sv); Enhanced prefers blink.sv
   * (the full-featured domain) and falls back to twentyone.ist, which still receives.
   */
  effective: string | null
}

/**
 * All Lightning Addresses the active self-custodial account holds, across BOTH domains.
 * Composes the SDK/persisted primary (useSelfCustodialLightningAddress) with the
 * REST-registered alt slot — the two never overlap in domain, so each domain lookup is
 * unambiguous. Every surface that offers, labels, or gates an address reads this so the
 * two-address rules live in exactly one place.
 */
export const useAccountLightningAddresses = (): AccountLightningAddresses => {
  const primary = useSelfCustodialLightningAddress()
  const { activeAccount, selfCustodialEntries } = useAccountRegistry()
  const { isAnonMode } = useSelfCustodialAccountMode()

  const activeEntry = selfCustodialEntries.find((entry) => entry.id === activeAccount?.id)
  const alt = activeEntry?.altLightningAddress ?? null

  const both = [primary, alt].filter((a): a is string => Boolean(a))
  const blinkSvAddress = both.find((a) => domainOf(a) === LnurlDomain.BlinkSv) ?? null
  const twentyoneIstAddress =
    both.find((a) => domainOf(a) === LnurlDomain.TwentyoneIst) ?? null

  const effective = isAnonMode
    ? twentyoneIstAddress
    : /** A regtest primary sits on staging.blink.sv — neither mainnet slot — so fall back
       *  to whatever the primary holds before declaring the account address-less. */
      blinkSvAddress ?? twentyoneIstAddress ?? primary

  return { primary, alt, blinkSvAddress, twentyoneIstAddress, effective }
}
