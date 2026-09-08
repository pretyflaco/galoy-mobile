# Nostr Signer POC — First Run for Colleagues

A side-by-side debug build of Blink with the **nostr-signer (NIP-46 remote
signing)** and **self-custodial Lightning Address / delegated-grants** POC work
on top. It installs next to the real Blink app — nothing is shared, nothing is
overwritten.

- **Package:** `com.galoyapp.nostrpoc2` (label: "Nostr Signer POC2")
- **Coexists with:** Play Store Blink (`com.galoyapp`), blink-vaults debug
  (`com.galoyapp.debug`), older POC (`com.galoyapp.nostrpoc`)
- **Artifacts:** every build is published under this repo's
  [Releases](../../releases) as a pre-release, named
  `blink-nostr-signer-poc2-v<code>-<date>.apk` with a `.sha256` sidecar.

---

## 1. Install

1. On the phone (or via `adb`), download the latest `*.apk` from
   [Releases](../../releases).
2. Open it → Android asks to allow "install unknown apps" for your
   browser/files app → allow → install.
3. **Play Protect will warn** ("unsafe app blocked" / "unknown developer").
   Expected — this is a debug-signed build, not a Play Store artifact. Choose
   *More details → Install anyway*.
4. Optional integrity check: `sha256sum` the downloaded file and compare with
   the `.sha256` sidecar attached to the same release.

**Updating:** just install the newer APK over the top — same debug signature,
no uninstall needed, app data (accounts, identity) survives.

**Fresh install caveat:** a full uninstall wipes the Android keychain, so your
nostr identity is gone. After a *fresh* install you must re-import your nsec or
create/derive a new identity. An *upgrade* keeps everything.

## 2. Get an account

Two ways in, depending on what you want to try:

- **Custodial (recommended for the sign-in demo):** log in with a regular Blink
  account (phone number). Balance loads immediately, Scan works, no extra
  setup. The POC demo flags are on in this build, so the nostr surfaces are
  visible without any remote-config changes.
- **Self-custodial (Incognito / Enhanced):** for the Lightning Address and
  delegated-grants surfaces. Back up the wallet seed when prompted — identity
  derivation and address registration are gated on that.

## 3. The demo: tap → approve → BTCPay dashboard (NIP-46 sign-in)

Proves the phone acts as a remote signer: BTCPay never sees your nsec.

1. Open the **Nostr Identity** hub (Settings → Nostr / Connected apps area) and
   create or import an identity.
2. In a browser, go to the staging BTCPay (`btcpay.twentyone.ist`) or `pay`'s
   BTCPay and choose **Sign in with Nostr (NostrConnect)** — it shows a
   `nostrconnect://` QR.
3. Scan it with the POC app (Scan screen). An **approval screen** shows who is
   asking (app name/avatar) — approve the connection.
4. A **second** approval follows for the sign-in event itself (`sign_event` is
   approval-gated — two modals is by design, not a bug).
5. The browser lands on your BTCPay dashboard. The connection now appears under
   **Connected apps** (Amber-style rows: name, relays, pubkey fingerprint) and
   can be revoked there.

Same-device flow (browser on the phone): approving returns you to the browser;
if it stalls on "Waiting for sign-in challenge…", the **Cancel** affordance on
the waiting overlay is the escape hatch (added in v799).

## 4. Lightning Addresses (self-custodial)

- Settings → **Lightning Address** → pick a domain (`blink.sv` default;
  `twentyone.ist` available because the grants flag is on in this build) →
  choose a username → success screen.
- An account can hold an address on **both** domains (primary + alt slot);
  paying either settles into the same wallet.
- Incognito accounts: only `twentyone.ist` addresses stay live; `blink.sv`
  reads "(disabled)".

## 5. Known POC limitations

- **Public relays** carry the NIP-46 traffic — sign-in latency varies with
  relay mood; a slow attempt is a relay finding, not necessarily a defect.
- Debug build: no Play signing, no push-notification polish, verbose internals.
- The demo flags (`nostrSignerEnabled`, `nonCustodialEnabled`,
  `delegatedGrantsEnabled`) are flipped ON in this build only; production
  defaults stay off.
- Each POC account's identity is account-scoped; switching accounts switches
  identity (that is intentional).

## 6. Feedback

File an issue on this repo (`pretyflaco/galoy-mobile`) with the POC version
(`v<code>`, shown in Settings → About / on the release you installed), the
account type (custodial / self-custodial), and what you tapped. `adb logcat`
output tagged `ReactNativeJS` is gold if you can grab it.
