#!/usr/bin/env node
/**
 * Story 4.2 — NIP-89 discoverability VERIFY script (ops/CI only).
 *
 * AD-15: ops-owned, under scripts/, never in app/. Fetches kind-31990 events authored by the ops
 * identity from the configured relays, fetches the domain's nostr.json, and runs the pure
 * `checkDiscoverable` predicate — confirming the MECHANISM by which an ecosystem client consuming
 * kind-31990 would list Blink (FR-17/CAP-9). It then prints the manual gate the operator must
 * satisfy: confirm at least one REAL ecosystem client lists Blink (inherently operational).
 *
 * Env (ops; nothing hardcoded — domain/pipeline are open SPEC deps, SPEC line 88):
 *   - NOSTR_SIGNER_ADVERT_AUTHOR  : the ops app-identity x-only pubkey (hex). REQUIRED.
 *   - NOSTR_SIGNER_ADVERT_RELAYS  : comma-separated relay URLs to query. REQUIRED.
 *   - NOSTR_SIGNER_ADVERT_DOMAIN  : the Blink-controlled domain serving /.well-known/nostr.json. REQUIRED.
 *
 * Run in CI/ops via `npx tsx scripts/verify-nip89-discoverability.ts` (ts-node/tsx present).
 */
import { SimplePool } from "nostr-tools/pool"

import { NIP89_HANDLER_KIND } from "./lib/nip89-advertisement"
import {
  checkDiscoverable,
  IOS_FOREGROUND_ONLY_ROLLOUT_BOUND,
  type FetchedEvent,
  type NostrJson,
} from "./lib/verify-nip89-discoverability"

const requireEnv = (key: string): string => {
  const value = process.env[key]
  if (!value || value.trim().length === 0) {
    throw new Error(`[verify-nip89] missing required ops env var: ${key}`)
  }
  return value.trim()
}

const fetchNostrJson = async (domain: string): Promise<NostrJson> => {
  const res = await fetch(`https://${domain}/.well-known/nostr.json?name=_`)
  if (!res.ok)
    throw new Error(`[verify-nip89] nostr.json fetch failed: HTTP ${res.status}`)
  return (await res.json()) as NostrJson
}

const main = async (): Promise<void> => {
  const authorPubkey = requireEnv("NOSTR_SIGNER_ADVERT_AUTHOR")
  const relays = requireEnv("NOSTR_SIGNER_ADVERT_RELAYS")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
  const domain = requireEnv("NOSTR_SIGNER_ADVERT_DOMAIN")

  const nostrJson = await fetchNostrJson(domain)

  const pool = new SimplePool()
  let events: FetchedEvent[] = []
  try {
    events = (await pool.querySync(relays, {
      kinds: [NIP89_HANDLER_KIND],
      authors: [authorPubkey],
    })) as unknown as FetchedEvent[]
  } finally {
    pool.close(relays)
  }

  const result = checkDiscoverable(events, { authorPubkey, nostrJson })

  console.log(
    `[verify-nip89] mechanism check: discoverable=${result.discoverable} (kind-31990 by ${authorPubkey}, NIP-46 handler, nostr.json cross-check on ${domain}).`,
  )
  console.log(
    `[verify-nip89] iOS rollout bound: foreground-only=${IOS_FOREGROUND_ONLY_ROLLOUT_BOUND.foregroundOnly}, background-response=${IOS_FOREGROUND_ONLY_ROLLOUT_BOUND.backgroundResponse}. ${IOS_FOREGROUND_ONLY_ROLLOUT_BOUND.note}`,
  )
  console.log(
    "[verify-nip89] MANUAL GATE (AC #1): confirm at least one real ecosystem client that consumes kind-31990 lists Blink as a signer option. This is operational and cannot be asserted in-repo.",
  )

  if (!result.discoverable) {
    console.error(
      "[verify-nip89] NOT discoverable: no valid kind-31990 Blink signer advertisement found. Publish (Story 4.1) and resolve the serving domain/pipeline first.",
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`[verify-nip89] FAILED: ${(err as Error).message}`)
  process.exit(1)
})
