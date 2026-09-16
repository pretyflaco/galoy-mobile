/**
 * NIP-05 orchestration for the identity hub (POC): automatically bind the identity's
 * nostr key to the account's `username@domain` handle at the lnurl server, then publish
 * the handle into the identity's kind-0 (`nip05` + `lud16`) so nostr clients show the
 * verified badge.
 *
 * Automatic by design — no toggle, no button: an existing identity + a resolvable
 * handle is sufficient consent (the binding attests things the account already owns;
 * the server upsert is idempotent). Both proofs come from seams that already exist:
 * the runtime self-signing seam for the kind-22242 proof event, and — per custody
 * mode — the bridge identity-key seam (spark) or the forwarded session token (blink).
 *
 * The kind-0 publish is skipped when the existing profile already carries the same
 * `nip05`/`lud16` (merge-preserving: picture/name/about set elsewhere are untouched).
 */
import { useCallback, useEffect, useRef, useState } from "react"

import { useApolloClient } from "@apollo/client"
import * as nip19 from "nostr-tools/nip19"

import { useFeatureFlags } from "@app/config/feature-flags-context"
import { GetUsernamesDocument } from "@app/graphql/generated"
import { useEffectiveAuthToken } from "@app/graphql/hooks/use-effective-auth-token"
import { useAppConfig } from "@app/hooks"
import {
  mergeProfileMetadata,
  PROFILE_PUBLISH_RELAYS,
} from "@app/nostr/core/profile-publish"
import {
  registerBlinkNostrIdentity,
  registerSparkNostrIdentity,
} from "@app/nostr/nip05/nip05-client"
import { buildNip05ProofTemplate } from "@app/nostr/nip05/proof"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"
import { useNostrAccountMode } from "@app/nostr/use-nostr-account-key"
import { signMessageWithIdentityKey } from "@app/self-custodial/bridge"
import { useSelfCustodialWallet } from "@app/self-custodial/providers/wallet"

export type Nip05Status =
  | { state: "pending" }
  | { state: "verified"; handle: string }
  | { state: "unsupported"; reason: string }
  | { state: "failed"; reason: string }

const log = (stage: string, detail: string): void => {
  console.warn(`[nostr-nip05] ${stage}: ${detail}`)
}

/** The lnurl-server host for a custodial account: the ln-address domain, sans `pay.`. */
export const custodialNip05Domain = (lnAddressHostname: string): string =>
  lnAddressHostname.replace(/^pay\./, "")

export const useNostrNip05 = (pubkeyHex: string | null): Nip05Status => {
  const nostr = useNostrRuntime()
  const featureFlags = useFeatureFlags()
  const apolloClient = useApolloClient()
  const authToken = useEffectiveAuthToken()
  const { isSelfCustodial } = useNostrAccountMode()
  const wallet = useSelfCustodialWallet()
  const {
    appConfig: {
      galoyInstance: { lnAddressHostname },
    },
  } = useAppConfig()
  const [status, setStatus] = useState<Nip05Status>({ state: "pending" })
  const inFlight = useRef(false)

  const run = useCallback(async () => {
    if (!pubkeyHex || !nostr) {
      setStatus({ state: "unsupported", reason: "no identity" })
      return
    }
    try {
      let registration
      if (isSelfCustodial) {
        // Spark account: the handle is the SDK-registered lnurl address; the auth is
        // the wallet identity-key signature over `nostr:{pubkey}-{timestamp}`.
        if (!wallet.sdk || !wallet.lightningAddress) {
          setStatus({ state: "unsupported", reason: "no lnurl address" })
          return
        }
        const domain = wallet.lightningAddress.split("@")[1]
        if (!domain) {
          setStatus({ state: "unsupported", reason: "malformed lnurl address" })
          return
        }
        const proof = await nostr.runtime.signAuthEvent(
          buildNip05ProofTemplate(wallet.lightningAddress),
        )
        registration = await registerSparkNostrIdentity({
          base: `https://${domain}`,
          nostrPubkey: pubkeyHex,
          nostrProof: JSON.stringify(proof),
          signMessage: (message) => signMessageWithIdentityKey(wallet.sdk!, message),
        })
      } else {
        // Custodial account: the handle is username@<ln-address-domain>; the auth is
        // the session token, validated server-side via GraphQL `me`.
        const { data } = await apolloClient.query({
          query: GetUsernamesDocument,
          fetchPolicy: "cache-first",
        })
        const username = data?.me?.username
        if (!username || !authToken) {
          setStatus({ state: "unsupported", reason: "no username" })
          return
        }
        const domain = custodialNip05Domain(lnAddressHostname)
        const handle = `${username}@${domain}`
        const proof = await nostr.runtime.signAuthEvent(buildNip05ProofTemplate(handle))
        registration = await registerBlinkNostrIdentity({
          base: `https://${domain}`,
          token: authToken,
          nostrPubkey: pubkeyHex,
          nostrProof: JSON.stringify(proof),
        })
      }

      // Publish the handle into the kind-0 profile (idempotent: skipped when unchanged).
      const existing = await nostr.runtime.fetchOwnProfileMetadata()
      const existingMeta: Record<string, unknown> = (() => {
        try {
          const parsed = existing ? JSON.parse(existing) : null
          return typeof parsed === "object" && parsed !== null ? parsed : {}
        } catch {
          return {}
        }
      })()
      if (
        existingMeta.nip05 !== registration.nip05 ||
        existingMeta.lud16 !== registration.nip05
      ) {
        const template = mergeProfileMetadata(existing, {
          nip05: registration.nip05,
          lud16: registration.nip05,
        })
        const published = await nostr.runtime.signAndPublish(template, [
          ...PROFILE_PUBLISH_RELAYS,
        ])
        if (!published)
          log("publish", "no relay ACK — handle stays registered server-side")
      }
      setStatus({ state: "verified", handle: registration.nip05 })
      log("done", registration.nip05)
    } catch (err) {
      log("failed", String(err))
      setStatus({ state: "failed", reason: String(err) })
    }
  }, [
    apolloClient,
    authToken,
    isSelfCustodial,
    lnAddressHostname,
    nostr,
    pubkeyHex,
    wallet.lightningAddress,
    wallet.sdk,
  ])

  useEffect(() => {
    if (!featureFlags.nostrNip05Enabled || inFlight.current) return
    inFlight.current = true
    run().finally(() => {
      inFlight.current = false
    })
  }, [featureFlags.nostrNip05Enabled, run])

  return status
}

/** npub (bech32) → x-only pubkey hex (lowercase); null for anything malformed. */
export const npubToHexPubkey = (npub: string | null): string | null => {
  if (!npub) return null
  try {
    const decoded = nip19.decode(npub)
    return typeof decoded.data === "string" ? decoded.data.toLowerCase() : null
  } catch {
    return null
  }
}
