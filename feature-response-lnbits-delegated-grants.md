# Implementation Response: LNbits Delegated Receive Grants (D2)

Status: complete — built, validated end-to-end on device
Created: 2026-08-24
Type: implementation-response
In response to: `feature-request-lnbits-delegated-grants.md` (2026-08-23)
Commit: `b534ebf7` on `feat/nostr-signer`
Validated with: POC APK `com.galoyapp.nostrpoc2` versionCode 792/793,
`bulus@lnurl.twentyone.ist`, LNbits devbox `https://lnbits.twentyone.ist`,
lnurl-server fork @ `lnurl.twentyone.ist`

## Summary

Everything in the feature request is implemented and was validated on a real
device against the devbox vertical: a self-custodial Blink user created a
delegated receive grant entirely in-app, pasted the DRGK into LNbits, received
a 50-sat payment to their Lightning Address through the LNbits instance (no
seed, no Breez API key configured there), and revoked the grant — after which
LNbits invoice requests fail immediately.

The request's "out of scope" follow-up — **deriving the nostr nsec from the
Spark seed** — was promoted into this POC and shipped as the **primary** nsec
creation option for self-custodial accounts (NIP-06).

## What was built (mapped to the request's tasks)

| Task | Delivered |
|---|---|
| Self-custodial detection in nostr scope (AC-7) | `useNostrAccountMode()` — `app/nostr/use-nostr-account-key.ts`; shares the custody predicate with scope resolution (deliberately not `use-active-wallet`'s SDK-availability-conflated flag). Failing test first: `__tests__/nostr/account-mode.spec.ts` |
| `sign_message` seam (AC-4) | `signMessageWithIdentityKey(sdk, message)` — `app/self-custodial/bridge/wallet.ts`; connected-SDK `SignMessageRequest(compact=false)` → `{pubkey, signature}` DER hex; interface-injectable for tests. Verified against SDK 0.15.0 type surface (no identity-key signing on `defaultExternalSigner`, so the connected instance is required) |
| DRGK keygen (AC-3) | `generateDrgkKeypair()` — `app/nostr/core/keygen.ts`; same fail-closed CSPRNG discipline as `generateNostrKey`, **33-byte compressed** pubkey hex (server's strict parser); never derived from the seed, never persisted |
| Grant API client (AC-4, AC-5) | `app/self-custodial/grants/grant-api.ts` — canonical signing (see corrections below), POST grant / DELETE revoke, full error mapping (rate-limit, conflict/hijack, invalid pubkey/expiry/signature, 404 not-found, network). `server.ts` — address-domain → base resolver. `grant-store.ts` — scoped local registry of public material only |
| Screens (AC-1, 2, 5, 6) | `app/screens/self-custodial/grants/delegated-grants-screen.tsx` — single-screen step machine (list → create/approval → success) so the DRGK hex never transits navigation params or storage; approval panel shows capability/address/fingerprint/expiry; success view = separate component so `useScreenSecurity` guards exactly the secret step; `useClipboard(60_000)` auto-clear |
| Flag + navigation (AC-8) | `delegatedGrantsEnabled` remote flag, production default **false** (wired through `feature-flags-context.tsx`); settings row double-gated on flag + self-custodial (`settings/delegated-grants.tsx`); route registered in `nostr-screens.tsx` + `stack-param-lists.ts` |
| Leak-audit + RNG coverage (AC-3) | `__tests__/self-custodial/drgk-keygen.spec.ts` — compressed-encoding checks, non-derivation-from-seed, storage-free module surface; existing keygen RNG suites untouched and green |
| E2E (AC-1, AC-5) | Validated 2026-08-24 — see below |

**Promoted from "out of scope":** NIP-06 nsec derivation —
`app/self-custodial/derive-nostr-key.ts` (`m/44'/1237'/0'/0/0` via
`@scure/bip32`+`@scure/bip39`, BIP-32 test-vector-verified golden vector);
"Derive from my wallet seed" is the primary create-identity CTA on
self-custodial accounts (random secondary, import unchanged); gated on the
wallet seed being backed up (`BackupRequiredModal`, mirrors the Lightning
Address gate); result screen notes the key can always be re-derived while
still recommending a separate backup; ceremony ports extended to allow async
keygen. Custody models deliberately opposite: nsec seed-derived by design,
DRGK seed-free.

## Validation per acceptance criterion

| AC | Evidence |
|---|---|
| AC-1 in-app delegation → LNbits receives without seed/API key | On-device 2026-08-24: grant created on the bulus account → DRGK pasted into LNbits devbox (seed removed from LNbits first) → 50-sat lnurlp created by LNbits user "elturco" → paid from another wallet → **payment confirmed, landed in the bulus wallet** |
| AC-2 approval screen content | Device screenshots: capability sentence ("REQUEST INVOICES for bulus@lnurl.twentyone.ist until 8/24/2027. It cannot spend your funds."), delegated-key fingerprint, expiry picker (90/180/365d) |
| AC-3 fresh CSPRNG DRGK, no seed material anywhere | Construction (keygen.ts never touches storage/mnemonic) + `drgk-keygen.spec.ts`; DRGK hex held only in screen state, dropped on leaving success view |
| AC-4 canonical signing + registration | Initially failed with `400 "invalid signature"` — root-caused against server source (see corrections); after the fix the POST succeeded and the grant appeared in the fork's `delegated_grants` (owner `0240e944…`) |
| AC-5 revoke → LNbits fails immediately | Revoked in-app; the same 50-sat lnurlp then failed with "Failed to fetch lnurl invoice". Server-side: `delegated_grants.revoked_at` set (grant `0328f523…`, created 1787527515, revoked 1787529146) |
| AC-6 clipboard auto-clear + screen security | `useClipboard(60_000)` (mirrors backup-phrase behavior incl. unmount clear); success view is its own component with `useScreenSecurity()` (screenshot/app-switcher blurring) |
| AC-7 custodial hidden | Row renders only when `isSelfCustodial && delegatedGrantsEnabled`; the screen itself re-checks both gates |
| AC-8 flag-gated, no production default-on | `delegatedGrantsEnabled` default `false` in committed tree; the demo build flips it locally (uncommitted, documented posture) |

Test suites: 33 new tests across 7 new spec files; full nostr +
self-custodial suites green (1694/1695; the single failure is the pre-existing
`feature-flag.spec` expectation vs the documented uncommitted demo override of
`nostrSignerEnabled`).

## Protocol corrections discovered during implementation

The feature request's canonical-string description was imprecise; the server
code (`src/routes/account.rs`) is ground truth:

1. **Grant signing:** the server's `validate()` appends `-{timestamp}` to the
   canonical message — the signed string is
   `grant:{delegated_pubkey}:{expiry_secs}-{timestamp}`, and the **same**
   timestamp must be sent in the body. Signing only
   `grant:{drgk}:{expiry_secs}` (as the doc read) fails with
   `400 "invalid signature"`. Cost one device round to find; the doc is fixed.
2. **Revocation:** signature+timestamp travel as **query params**
   (`Query<RevokeDelegatedKeyParams>`), not a JSON body; signed string is
   `revoke:{delegated_pubkey}-{timestamp}`.
3. **Expiry:** server-capped at `(0, 365d]` — never-expiring grants are
   rejected by design (dead-man's switch); rotation is a same-owner upsert.

Verification goes through `spark_client.verify_message` (SSP-side), which
pairs with the SDK's `signMessage` — the same scheme that made D1 address
registration work.

## Platform/build fixes discovered (all documented in the runbook)

- **`react-native-config` + `applicationIdSuffix`:** the native module reflects
  on `<applicationId>.BuildConfig`; with the `.nostrpoc2` suffix that class
  doesn't exist → `Config` empty → every Spark SDK init threw. Latent in ALL
  prior POC builds (masked by custodial-only testing). Fixed with
  `resValue "string", "build_config_package", "com.galoyapp"` in the debug
  block (local/uncommitted).
- **`SPARK_TOKEN_IDENTIFIER`** must be set for any self-custodial SDK init
  (mainnet USDB identifier sourced from Flashnet's public docs).
- **Fork domain:** the SDK's `lnurlDomain` must point at
  `lnurl.twentyone.ist` for the grant endpoints to exist (local override of
  `MAINNET_LNURL_DOMAIN`; production `blink.sv` unchanged in the tree).
- **Stale persisted-address fallback:** the SDK can lose its local
  `lightning_address` record across restarts while the registration stays
  valid server-side. `useSelfCustodialLightningAddress` now ignores persisted
  addresses on a stale domain (so re-registration is offered), and the grants
  screen + settings banner consume its live-??-persisted resolution instead of
  the live SDK value alone.

## Demo-build posture

Committed (`b534ebf7`, 33 files): all feature code, tests, i18n, and the
updated feature-request doc. Deliberately uncommitted (documented POC-only
overrides): demo flag flips (`nostrSignerEnabled`, `nonCustodialEnabled`,
`delegatedGrantsEnabled`), `MAINNET_LNURL_DOMAIN` fork override, gradle debug
block (`applicationIdSuffix`, `build_config_package`, versionCode),
`.env.local`.

## Remaining follow-ups (unchanged from the request)

- Upstream (blink-mobile) productization of the delegation UI
- LNbits-side UX (admin tooltip pointing to the app flow)
- Renewal/rotation nudges before the 365d cap
- Optional hardening: mapping of `invalid timestamp` to a clock-skew hint in UI
