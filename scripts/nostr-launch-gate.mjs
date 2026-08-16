#!/usr/bin/env node
/**
 * Story 1.8 — nostr-signer launch gate (NFR-3 leak-audit + NFR-4 RNG release gate).
 *
 * A CI/release entrypoint that runs the automated leak-audit and RNG-gate test suites and
 * exits non-zero on any failure, so a release that would ship a key-material leak or a
 * deterministic RNG is BLOCKED. Wire this into the release pipeline before shipping the
 * signer (behind the AD-13 feature flag) on any channel.
 */
import { spawnSync } from "node:child_process"

const SUITES = [
  "__tests__/nostr/leak-audit.spec.ts",
  "__tests__/nostr/leak-audit-runtime.spec.ts",
  "__tests__/nostr/rng-gate.spec.ts",
]

const result = spawnSync("yarn", ["jest", "--runInBand", "--forceExit", ...SUITES], {
  stdio: "inherit",
  env: { ...process.env, LOGLEVEL: "warn" },
})

if (result.status !== 0) {
  console.error(
    "\n[nostr-launch-gate] BLOCKED: key-material leak-audit or RNG release gate failed. " +
      "Do not ship the signer until this is green (NFR-3 / NFR-4).",
  )
  process.exit(result.status ?? 1)
}

console.log("[nostr-launch-gate] PASS: no key-material leak; RNG gate satisfied.")
