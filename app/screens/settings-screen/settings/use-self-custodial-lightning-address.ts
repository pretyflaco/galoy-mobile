import { useAccountRegistry } from "@app/hooks/use-account-registry"
import { lnurlDomainFor } from "@app/self-custodial/config"
import { useSparkNetwork } from "@app/self-custodial/hooks/use-spark-network"
import { useSelfCustodialWallet } from "@app/self-custodial/providers/wallet"

/**
 * Resolves the active self-custodial account's lightning address, preferring the
 * live SDK value but falling back to the persisted one while the SDK reconnects,
 * so a user who already registered never sees the "create address" prompt.
 *
 * A persisted address registered under a DIFFERENT lnurl domain than the SDK's
 * configured one (e.g. registered on blink.sv before the build pointed the SDK at
 * another lnurl server) is stale — the SDK only knows addresses on its configured
 * domain. It is treated as unset so the user can re-register instead of being shown
 * a dead, unchangeable address.
 */
export const useSelfCustodialLightningAddress = (): string | null => {
  const { activeAccount, selfCustodialEntries } = useAccountRegistry()
  const { lightningAddress: liveLightningAddress } = useSelfCustodialWallet()
  const network = useSparkNetwork()

  const persistedLightningAddress =
    selfCustodialEntries.find((entry) => entry.id === activeAccount?.id)
      ?.lightningAddress ?? null

  const persistedMatchesDomain =
    persistedLightningAddress?.split("@")[1]?.trim().toLowerCase() ===
    lnurlDomainFor(network)

  return (
    liveLightningAddress ?? (persistedMatchesDomain ? persistedLightningAddress : null)
  )
}
