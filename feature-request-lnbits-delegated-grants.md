# Feature Request: LNbits Delegated Receive Grants (D2)

Status: implemented (POC validated end-to-end 2026-08-24, APK versionCode 792)
Created: 2026-08-23
Type: feature-request
Target: blink-nostr-signer POC (this repo, branch `feat/nostr-signer`)

## Summary

Let a Blink **self-custodial (Spark)** account user grant a third-party LNbits
instance **receive-only** access to their Lightning Address — without exposing
the Spark seed — by generating, signing, and registering a **Delegated Receive
Grant Key (DRGK)** entirely inside the app, then copying the DRGK private key
into LNbits admin settings.

This is the missing user-facing half of the D2 delegated-grants API already
implemented on the `blink-lnurl-server` fork.

## Background

- LNbits fork `pretyflaco/lnbits`, branch
  `feat/blink-noncustodial-funding-source`, implements
  `BlinkNonCustodialWallet`: an LNbits funding source backed by a user's Blink
  Lightning Address. With only an address it can receive (LNURL-pay +
  LUD-21 verify + D1 signed description-hash invoices). Sending requires the
  Spark seed, which users should NOT paste into a third-party LNbits.
- D2 delegated grants (spec: `blink-wip#1158`) solve this: the account owner
  authorizes an auxiliary secp256k1 key to request invoices on the account's
  behalf. The DRGK has **no spend authority**, is capped at **1-year expiry**,
  and is **revocable at any time**.
- Server side is done on the lnurl-server fork
  (`blink-lnurl-server`, branch `feat/d1-signed-invoice-endpoint`, tip
  `80a928b`):
  - `POST /lnurlpay/{owner_pubkey}/grant` — body
    `{delegated_pubkey, expiry_secs, timestamp, signature}`. **Protocol detail
    (verified against `src/routes/account.rs`):** `signature` is the owner's
    Spark **identity key** signature over
    `grant:{delegated_pubkey}:{expiry_secs}-{timestamp}` — the server's
    `validate()` appends `-{timestamp}` to the canonical message before
    verification, and the SAME timestamp must be sent in the body (DER hex,
    sha256 digest — same `sign_message(compact=false)` scheme as D1
    registration). Signing only `grant:{...}:{...}` without the timestamp
    suffix fails with `400 "invalid signature"`.
  - `DELETE /lnurlpay/{owner_pubkey}/grant/{delegated_pubkey}?signature=…&timestamp=…`
    — revocation. **Protocol detail:** signature+timestamp travel as QUERY
    PARAMS (`Query<RevokeDelegatedKeyParams>`), NOT a JSON body; the signed
    message is `revoke:{delegated_pubkey}-{timestamp}`.
  - Server enforces: expiry in `(0, 365d]`, delegated key ≠ identity key,
    owner must be a registered Spark account, rebinding a delegated key to a
    different owner is rejected (hijack guard), same-owner rotation allowed.
- LNbits side is done: admin settings field `blink_noncustodial_grant_privkey`
  (hex). When present, it signs D1 description-hash invoice requests
  (plain coincurve ECDSA, sha256, DER) — **no seed and no Breez API key
  needed** on the LNbits instance. Sends stay disabled without the seed.

## Problem

Creating a grant today is developer plumbing:

1. Someone generates the DRGK keypair with a script.
2. The owner signs `grant:{pubkey}:{expiry}` — but the Spark identity key
   exists **only inside the wallet's secure storage**. Signing outside the app
   means exporting the seed, which defeats the entire purpose of D2.
3. The grant is registered with a raw API call.

There is no UI for any of this in Blink mobile, the lnurl-server, or LNbits.
An ordinary user cannot use the feature at all. The signing step must happen
inside the app — this repo is the fastest vehicle for that POC.

## Proposed flow (app-side generation)

All steps happen in this app; the user's seed never leaves secure storage and
the DRGK private key is generated fresh on-device.

1. **Entry point**: Settings (self-custodial account) → new row, e.g.
   "Receive-only access" / "Connected services".
2. **Create delegation screen**:
   - App generates a **fresh random** secp256k1 keypair (fail-closed RNG,
     same discipline as `app/nostr/core/keygen.ts` — do NOT derive from the
     Spark seed; a fresh key keeps rotation/revocation independent of the
     seed).
   - App resolves the account's Lightning Address domain → lnurl-server base
     (`user@lnurl.twentyone.ist` → `https://lnurl.twentyone.ist`;
     `@blink.sv` → Blink's own server, per upstream-acceptance assumption).
   - User picks expiry (default 90d, max 365d).
   - Approval panel states the capability in plain words: "The connected
     service will be able to REQUEST INVOICES for `<address>` until
     `<date>`. It cannot spend your funds."
   - On confirm: sign `grant:{drgk_pubkey}:{expiry_secs}` with the Spark
     identity key via the self-custodial bridge
     (`breez_sdk_spark.sign_message(SignMessageRequest(message=…,
compact=False))` → `.pubkey` + `.signature`, DER hex).
   - App POSTs the grant to the lnurl-server directly (see "Why in-app
     registration" below) and shows success/failure.
3. **Success screen**: DRGK private key (hex) with **Copy** and **QR** buttons
   plus instructions: "Paste this key into LNbits → Admin → Funding Source →
   Blink (non-custodial) → Delegated Receive Grant Key". Clipboard auto-clear
   after 60s (mirror the backup-phrase behavior,
   `use-view-backup-phrase.ts`).
4. **Delegation list**: active grants with delegated key fingerprint, expiry
   countdown, and a **Revoke** action (owner-signed DELETE to the server).

Clipboard caveat (accepted trade-off): the DRGK private key transits the
user's clipboard/whatever channel they use to deliver it to the LNbits
operator. Acceptable because it is receive-only, expiring, and revocable.

### Why in-app registration

Signing alone does nothing — the grant exists only once the lnurl-server
stores it. The app already knows every ingredient (owner pubkey, fresh
signature, expiry, server domain derived from the address), so one tap =
sign + register. The alternative (app returns a signature blob that LNbits
registers) forces the user to hand over two artifacts and adds a manual
registration step on the LNbits side.

## POC prerequisites (minimal non-custodial wiring)

The nostr-signer POC currently integrates only with **custodial** Blink
sessions. Evidence: zero Spark/Breez imports under `app/nostr/`
(`nostr-runtime-provider.tsx:106-107` — "custodial accounts only"),
`nonCustodialEnabled: false` default (`app/config/feature-flags-context.tsx`),
account scoping nominally supports self-custodial but no wallet-facing
feature uses it (`app/nostr/core/account-scope.ts`).

Minimal wiring needed for this feature — deliberately NOT full nostr-identity
integration:

- Detect the active **self-custodial** account and scope state to it
  (`persistentState.activeAccountId` path already sketched in
  `account-scope.ts:33`).
- A `sign_message` seam through the existing self-custodial bridge
  (`app/self-custodial/bridge/lifecycle.ts`, which already connects the Breez
  SDK from `KeyStoreWrapper.getMnemonicForAccount`). The DRGK signature uses
  the **Spark identity key**, not the nostr nsec — the nostr signer stack
  (`local-nsec-signer.ts`, BIP-340 Schnorr) is the wrong key and the wrong
  curve form for this. Reuse the app shell (screens, RNG, keystore patterns),
  not the nsec.
- Resolve the self-custodial account's Lightning Address (it is the
  registered username on the lnurl-server; the registration contract is the
  same server's `POST /lnurlpay/{pubkey}` flow).

## Acceptance Criteria

1. (AC-1) A self-custodial user can create a delegation entirely in-app and
   end up with a DRGK private key they can paste into LNbits admin; the
   resulting LNbits instance receives payments for their address without any
   seed or Breez API key configured.
2. (AC-2) The approval screen displays the delegated capability, target
   address, delegated key fingerprint, and expiry date before signing.
3. (AC-3) The DRGK keypair is freshly generated from the secure RNG and is
   never derived from, or stored alongside, the Spark seed. No seed material
   is included in any log, backup, or clipboard operation. (leak-audit suite)
4. (AC-4) Grant creation signs exactly `grant:{pubkey}:{expiry_secs}` and
   registers it via `POST /lnurlpay/{owner}/grant`; server verification
   passes (signature, timestamp freshness, expiry ≤ 365d).
5. (AC-5) The delegation list shows active grants and Revocation calls the
   DELETE endpoint; after revocation, LNbits invoice requests fail
   immediately (verified against the devbox lnurl-server).
6. (AC-6) Clipboard copy of the DRGK private key auto-clears after 60s and
   the success screen is excluded from screenshots/app-switcher previews
   (`useScreenSecurity`), mirroring the backup-phrase screen.
7. (AC-7) Custodial accounts do not see the feature (hidden row), matching
   the D2 server requirement that the granting key belong to a Spark
   account.
8. (AC-8) Feature is behind a flag (`nostrSignerEnabled`-style remote flag or
   the existing demo-build override pattern) — no production default-on.

## Tasks / Subtasks

- [x] Wire minimal self-custodial account detection into the nostr module
      scope (AC-7). Failing test first: account-scope resolution for a
      self-custodial session. (`useNostrAccountMode` in
      `app/nostr/use-nostr-account-key.ts`)
- [x] Add `sign_message` seam to the self-custodial bridge with injected
      request/response (testable without a live SDK); wire to Breez SDK
      `SignMessageRequest(compact=False)` (AC-4).
      (`signMessageWithIdentityKey` in `app/self-custodial/bridge/wallet.ts`)
- [x] Implement DRGK keygen via `app/nostr/core/keygen.ts` RNG discipline +
      secp256k1 pubkey derivation (compressed, 33-byte → hex) (AC-3).
      (`generateDrgkKeypair`)
- [x] Implement grant API client: base-URL derivation from lightning address
      domain, POST grant, DELETE revoke, error mapping (rate-limit,
      conflict/hijack, invalid expiry) (AC-4, AC-5).
      (`app/self-custodial/grants/grant-api.ts`)
- [x] Build screens: entry row (self-custodial only), create/approval,
      success (key + QR + copy + screen-security + clipboard auto-clear),
      delegation list with revoke (AC-1, AC-2, AC-5, AC-6).
      (`app/screens/self-custodial/grants/delegated-grants-screen.tsx`)
- [x] Feature flag + navigation wiring (AC-8). (`delegatedGrantsEnabled`)
- [x] Leak-audit + RNG test-suite coverage for the new key path (AC-3).
- [x] E2E against devbox: `lnbitsdev@lnurl.twentyone.ist` +
      `https://lnbits.twentyone.ist` — full cycle validated 2026-08-24 on
      `bulus@lnurl.twentyone.ist`: create in app → paste key in LNbits →
      50-sat payment received → revoke → invoice fetch fails (AC-1, AC-5).

## Validation notes (2026-08-24)

- Build fixes required for the POC APK: `react-native-config` needs
  `resValue "string", "build_config_package", "com.galoyapp"` when the build
  uses `applicationIdSuffix` (otherwise `Config` is empty and Spark SDK init
  throws); `SPARK_TOKEN_IDENTIFIER` must be set for self-custodial SDK init.
- The SDK's Lightning-Address domain must point at the fork
  (`lnurl.twentyone.ist`) for the grant flow to hit the D2 endpoints; an
  address registered on production `blink.sv` fails (no D2 there).
- The SDK can lose its local `lightning_address` record across an app
  restart while the server-side registration stays valid — consumers must
  fall back to the persisted account-index entry (domain-matched), as
  `useSelfCustodialLightningAddress` does.
- Protocol gotcha that cost a round-trip: the signed string includes the
  timestamp suffix (see "Server side" above); the doc's original wording
  (`grant:{pubkey}:{expiry}`) was imprecise.

## Dev Notes

- Signature scheme must match the server's `validate()` exactly: signed string =
  `grant:{delegated_pubkey}:{expiry_secs}-{timestamp}` (the server appends
  `-{timestamp}` itself), sha256 digest, ECDSA over secp256k1, DER-encoded hex
  signature, and the same `timestamp` (unix seconds) in the request within the
  server's freshness window. The D1 registration flow in LNbits
  (`lnbits/wallets/blink_noncustodial.py`) is a working reference client for
  this scheme.
- Revocation signs `revoke:{delegated_pubkey}-{timestamp}` and passes
  signature+timestamp as query parameters on the DELETE.
- `expiry_secs` is part of the signed message: rotating an expiry means a
  new signature (server treats it as same-owner rotation/upsert).
- Compressed-pubkey encoding: the server parses `delegated_pubkey` with a
  strict secp256k1 pubkey parser — use 33-byte compressed hex (the identity
  pubkey returned by `sign_message` is the reference format).
- Do not reuse `local-nsec-signer.ts` for grant signing: x-only Schnorr over
  the nsec is the wrong key AND wrong signature form. The nsec↔Spark-seed
  relationship is a separate follow-up (below).
- Server error strings worth mapping to friendly UI: `invalid pubkey`,
  `cannot delegate to the identity key`, `invalid expiry`,
  rate-limit (429), grant-conflict (hijack guard).

## Out of scope (explicit follow-ups)

- ~~Derive the nostr nsec from the Spark seed~~ **DONE (promoted into this
  POC)**: NIP-06 derivation (`m/44'/1237'/0'/0/0`) is the primary nsec
  creation option for self-custodial accounts
  (`app/self-custodial/derive-nostr-key.ts`), gated on the wallet seed being
  backed up (BackupRequiredModal, mirroring the Lightning Address gate);
  fresh-random stays as the secondary option. The DRGK path remains
  deliberately seed-independent (AC-3) — opposite custody models, separate
  code paths.
- Upstream (blink-mobile) productization of the delegation UI.
- LNbits-side UI changes (the admin field stays a plain hex paste field; a
  tooltip pointing to the app flow is a nice-to-have on the LNbits fork).
- Renewal/rotation reminders (expiry is capped at 365d; a renewal nudge is
  future UX work).

## References

- Spec: `blink-wip#1158` (D1/D2 research & spec)
- lnurl-server fork: `pretyflaco/blink-lnurl-server`, branch
  `feat/d1-signed-invoice-endpoint` (D2: `grant_delegated_key` in
  `src/routes/account.rs`, migrations for `delegated_grants`)
- LNbits fork: `pretyflaco/lnbits`, branch
  `feat/blink-noncustodial-funding-source`
  (`lnbits/wallets/blink_noncustodial.py`, `lnbits/settings.py:582`)
- This repo: branch `feat/nostr-signer` @ `ffb89176`
  - RNG discipline: `app/nostr/core/keygen.ts`
  - Account scoping: `app/nostr/core/account-scope.ts`
  - Custodial-only evidence: `app/nostr/nostr-runtime-provider.tsx:106`
  - Self-custodial bridge: `app/self-custodial/bridge/lifecycle.ts`
  - Clipboard auto-clear reference:
    `app/screens/self-custodial/onboarding/hooks/use-view-backup-phrase.ts`
