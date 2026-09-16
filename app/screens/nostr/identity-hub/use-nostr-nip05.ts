/**
 * NIP-05 orchestration for the identity hub (POC): automatically bind the identity's
 * nostr key to every Lightning Address the account holds — `username@domain` at each
 * domain's lnurl server — then advertise the first confirmed handle in the identity's
 * kind-0 (`nip05` + `lud16`) so nostr clients show the verified badge.
 *
 * Automatic by design — no toggle, no button: an existing identity + a held address is
 * sufficient consent (the binding attests things the account already owns; the server
 * upsert is idempotent). Proofs come from seams that already exist: the runtime
 * self-signing seam for the per-handle kind-22242 proof event, and — per custody mode —
 * the bridge identity-key seam (spark) or the forwarded session token (blink).
 *
 * Handle resolution (2026-09-17 fix): read BOTH domains from useAccountLightningAddresses —
 * the SDK-known primary AND the REST-registered alt address (set-address flow). The alt
 * slot exists precisely because the SDK never learns of it; reading only
 * wallet.lightningAddress made the flow target the wrong server (prod blink.sv, no
 * NIP-05 routes) while the account's alt address sat registered on the POC server.
 * Each target registers against its own domain; a 404 skips that target silently
 * (server without NIP-05 routes — e.g. production until deploy sync — or a key with no
 * username there), other failures are logged with the target for debuggability.
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
  Nip05RegisterError,
  registerBlinkNostrIdentity,
  registerSparkNostrIdentity,
} from "@app/nostr/nip05/nip05-client"
import { buildNip05ProofTemplate } from "@app/nostr/nip05/proof"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"
import { useNostrAccountMode } from "@app/nostr/use-nostr-account-key"
import { signMessageWithIdentityKey } from "@app/self-custodial/bridge"
import { useAccountLightningAddresses } from "@app/self-custodial/hooks/use-account-lightning-addresses"
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

const domainOf = (handle: string): string | undefined =>
  handle.split("@")[1]?.trim().toLowerCase()

/** Skip-with-log for targets whose server cannot serve them (yet). */
const isSkippable = (err: unknown): boolean =>
  err instanceof Nip05RegisterError && err.kind === "not-provisioned"

type Runtime = NonNullable<ReturnType<typeof useNostrRuntime>>

type TargetResult =
  | { kind: "verified"; handle: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: string }

/** Register one spark handle against its own domain's lnurl server. */
const registerSparkHandle = async (params: {
  nostr: Runtime
  handle: string
  nostrPubkey: string
  signed: { pubkey: string; signature: string }
}): Promise<TargetResult> => {
  const { nostr, handle, nostrPubkey, signed } = params
  const domain = domainOf(handle)
  if (!domain) return { kind: "failed", reason: `${handle}: malformed handle` }
  const base = `https://${domain}`
  try {
    const proof = await nostr.runtime.signAuthEvent(buildNip05ProofTemplate(handle))
    const registration = await registerSparkNostrIdentity({
      base,
      nostrPubkey,
      nostrProof: JSON.stringify(proof),
      signMessage: async () => signed,
    })
    return { kind: "verified", handle: registration.nip05 }
  } catch (err) {
    if (isSkippable(err)) {
      return {
        kind: "skipped",
        reason: `${handle} at ${base}: no NIP-05 route there yet`,
      }
    }
    return { kind: "failed", reason: `${handle} at ${base}: ${String(err)}` }
  }
}

/** Publish the handle into the kind-0 profile (idempotent: skipped when unchanged). */
const publishHandleToProfile = async (nostr: Runtime, handle: string): Promise<void> => {
  const existing = await nostr.runtime.fetchOwnProfileMetadata()
  const existingMeta: Record<string, unknown> = (() => {
    try {
      const parsed = existing ? JSON.parse(existing) : null
      return typeof parsed === "object" && parsed !== null ? parsed : {}
    } catch {
      return {}
    }
  })()
  if (existingMeta.nip05 === handle && existingMeta.lud16 === handle) return
  const template = mergeProfileMetadata(existing, { nip05: handle, lud16: handle })
  const published = await nostr.runtime.signAndPublish(template, [
    ...PROFILE_PUBLISH_RELAYS,
  ])
  if (!published) log("publish", "no relay ACK — handle stays registered server-side")
}

export const useNostrNip05 = (pubkeyHex: string | null): Nip05Status => {
  const nostr = useNostrRuntime()
  const featureFlags = useFeatureFlags()
  const apolloClient = useApolloClient()
  const authToken = useEffectiveAuthToken()
  const { isSelfCustodial } = useNostrAccountMode()
  const wallet = useSelfCustodialWallet()
  const addresses = useAccountLightningAddresses()
  const {
    appConfig: {
      galoyInstance: { lnAddressHostname },
    },
  } = useAppConfig()
  const [status, setStatus] = useState<Nip05Status>({ state: "pending" })
  const inFlight = useRef(false)

  const run = useCallback(async () => {
    if (!pubkeyHex || !nostr) {
      log("unsupported", "no identity")
      setStatus({ state: "unsupported", reason: "no identity" })
      return
    }
    try {
      let verified: string | null = null
      const failures: string[] = []

      if (isSelfCustodial) {
        // Every mainnet handle the account holds — the SDK's primary domain AND the
        // REST-registered alt domain — each registered against its own server.
        const targets = [addresses.blinkSvAddress, addresses.twentyoneIstAddress].filter(
          (handle): handle is string => Boolean(handle),
        )
        if (!wallet.sdk) {
          log("unsupported", "sdk not connected")
          setStatus({ state: "unsupported", reason: "sdk not connected" })
          return
        }
        if (targets.length === 0) {
          log("unsupported", "no mainnet lightning address")
          setStatus({ state: "unsupported", reason: "no mainnet lightning address" })
          return
        }

        // One spark signature covers every target (the canonical message binds the
        // nostr pubkey, not the handle); the proof event is per-handle.
        const timestamp = Math.floor(Date.now() / 1000)
        const signed = await signMessageWithIdentityKey(
          wallet.sdk,
          `nostr:${pubkeyHex}-${timestamp}`,
        )

        for (const handle of targets) {
          const result = await registerSparkHandle(nostr, handle, pubkeyHex, signed)
          if (result.kind === "verified") {
            log(`registered ${result.handle}`, "spark path")
            if (!verified) {
              // kind-0 carries a single nip05 field — advertise the first confirmed
              // handle; further domains still verify the same key via nostr.json.
              await publishHandleToProfile(nostr, result.handle)
              verified = result.handle
            }
          } else if (result.kind === "skipped") {
            log("skip", result.reason)
          } else {
            failures.push(result.reason)
            log("failed", result.reason)
          }
        }
      } else {
        // Custodial account: the handle is username@<ln-address-domain>; the auth is
        // the session token, validated server-side via GraphQL `me`. 404 skips
        // silently — production does not run the route yet, and unprovisioned
        // usernames are the expected initial state (Blink Core provisions them).
        const { data } = await apolloClient.query({
          query: GetUsernamesDocument,
          fetchPolicy: "cache-first",
        })
        const username = data?.me?.username
        if (!username || !authToken) {
          log("unsupported", "no username")
          setStatus({ state: "unsupported", reason: "no username" })
          return
        }
        const domain = custodialNip05Domain(lnAddressHostname)
        const handle = `${username}@${domain}`
        const base = `https://${domain}`
        try {
          const proof = await nostr.runtime.signAuthEvent(buildNip05ProofTemplate(handle))
          const registration = await registerBlinkNostrIdentity({
            base,
            token: authToken,
            nostrPubkey: pubkeyHex,
            nostrProof: JSON.stringify(proof),
          })
          await publishHandleToProfile(nostr, registration.nip05)
          verified = registration.nip05
        } catch (err) {
          if (isSkippable(err)) {
            log("skip", `${handle} at ${base}: no NIP-05 route or username there yet`)
          } else {
            failures.push(`${handle} at ${base}: ${String(err)}`)
            log("failed", `${handle} at ${base}: ${String(err)}`)
          }
        }
      }

      if (verified) {
        setStatus({ state: "verified", handle: verified })
        log("done", verified)
      } else if (failures.length > 0) {
        setStatus({ state: "failed", reason: failures.join("; ") })
      } else {
        setStatus({
          state: "unsupported",
          reason: "no target server could verify a handle",
        })
      }
    } catch (err) {
      log("failed", String(err))
      setStatus({ state: "failed", reason: String(err) })
    }
  }, [
    addresses.blinkSvAddress,
    addresses.twentyoneIstAddress,
    apolloClient,
    authToken,
    isSelfCustodial,
    lnAddressHostname,
    nostr,
    pubkeyHex,
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
