#!/usr/bin/env node
/**
 * Story 4.1 — NIP-89 (kind-31990) signer advertisement PUBLISH script (ops/CI only).
 *
 * AD-15: publishes the Blink signer advertisement under a dedicated Blink-operated app identity
 * whose nsec lives in OPS SECRET STORAGE, by this VERSIONED script run from CI/ops — NEVER from a
 * user device, and NEVER bundled into the mobile app. Nothing under `app/` imports this file.
 *
 * All environment-specific values are supplied from ops env (no domain/relay/key hardcoded — the
 * serving domain + owning pipeline are OPEN SPEC dependencies, SPEC line 88):
 *   - NOSTR_SIGNER_ADVERT_NSEC : the ops app-identity nsec as hex (from secret storage). REQUIRED.
 *   - NOSTR_SIGNER_ADVERT_RELAYS : comma-separated relay URLs to publish to. REQUIRED.
 *   - NOSTR_SIGNER_ADVERT_DOMAIN : the Blink-controlled domain serving /.well-known/nostr.json
 *                                  (used only for an operator-facing verification hint). OPTIONAL.
 *
 * Run in CI/ops via the repo's TypeScript runner, e.g. `npx tsx scripts/publish-nip89-advertisement.ts`
 * (ts-node/tsx are both present). It builds → signs (ops nsec) → publishes → prints the
 * nostr.json cross-check the operator must satisfy on the serving domain.
 */
import { finalizeEvent } from "nostr-tools/pure"
import { SimplePool } from "nostr-tools/pool"

import {
  prepareAdvertisementForPublish,
  type AdvertisementMetadata,
} from "./lib/nip89-advertisement"

/** The advertisement metadata identifying blink-mobile as a NIP-46 signer (FR-17). */
const METADATA: AdvertisementMetadata = {
  name: "blink",
  // eslint-disable-next-line camelcase
  display_name: "Blink",
  about: "Sign in with Blink — a NIP-46 remote signer built into blink-mobile.",
}

const requireEnv = (key: string): string => {
  const value = process.env[key]
  if (!value || value.trim().length === 0) {
    throw new Error(`[publish-nip89] missing required ops env var: ${key}`)
  }
  return value.trim()
}

const main = async (): Promise<void> => {
  // The ops nsec comes from secret storage; prepareAdvertisementForPublish refuses if absent.
  const readNsecHex = (): string => process.env.NOSTR_SIGNER_ADVERT_NSEC ?? ""
  const relays = requireEnv("NOSTR_SIGNER_ADVERT_RELAYS")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
  if (relays.length === 0) {
    throw new Error(
      "[publish-nip89] NOSTR_SIGNER_ADVERT_RELAYS resolved to an empty relay set.",
    )
  }

  const signed = prepareAdvertisementForPublish({
    readNsecHex,
    metadata: METADATA,
    createdAt: Math.floor(Date.now() / 1000),
    finalize: finalizeEvent,
  })

  const pool = new SimplePool()
  try {
    await Promise.allSettled(pool.publish(relays, signed))
  } finally {
    pool.close(relays)
  }

  const domain = process.env.NOSTR_SIGNER_ADVERT_DOMAIN
  // Operator-facing verification hint (AD-15 author cross-check). No key material logged.
  console.log(
    `[publish-nip89] published kind-31990 advertisement id=${signed.id} pubkey=${signed.pubkey} to ${relays.length} relay(s).`,
  )
  console.log(
    `[publish-nip89] VERIFY: ${
      domain ? `https://${domain}` : "<blink-controlled-domain>"
    }/.well-known/nostr.json?name=_ must return names._ === ${signed.pubkey} (AD-15).`,
  )
}

main().catch((err) => {
  console.error(`[publish-nip89] FAILED: ${(err as Error).message}`)
  process.exit(1)
})
