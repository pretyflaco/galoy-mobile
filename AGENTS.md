# Blink Mobile - AI Agent Guidelines

## Documentation

Based on the PR's changed files, read relevant docs thoroughly:

| Document | When to Read |
|----------|--------------|
| /docs/architecture.md | Changes to providers, navigation, state management, auth flow |
| /docs/api-reference.md | GraphQL queries/mutations, Apollo client changes |
| /docs/source-tree-analysis.md | New files, directory structure questions |
| /docs/technology-stack.md | Dependency changes, build config, new packages |
| /docs/pr-review.md | Reviewing a PR, or authoring one (conventions, checklists, review standards) |

**Then read /docs/index.md** - it's the master index linking to additional docs (dev setup, E2E testing, i18n guide, etc.). Follow relevant references if they apply to the PR.

## Critical Rules (Always Apply)
- `app/graphql/generated.ts` is AUTO-GENERATED - never modify manually
- Payment mutations must NOT have retry logic (handled specially in client.tsx)
- Sensitive data → react-native-keychain, not AsyncStorage
- All user-facing strings via typesafe-i18n

## Fork Ops (nostr-signer POC fork — read before syncing or building)

This repo is `pretyflaco/galoy-mobile` (fork of `blinkbitcoin/blink-mobile`), working
branch `feat/nostr-signer`. The full, canonical procedures live outside this repo —
read them before any upstream sync or APK build:
`~/Documents/BLINK/btcpay.blink.sv/_bmad-output/implementation-artifacts/keeping-fork-uptodate.md`
(sync procedure) and `poc-runbook.md` (same folder; build recipe + device-test findings).

**Two files stay permanently UNCOMMITTED** (local demo overrides — never commit, never
let a merge stage them). They should be the only dirty tracked files before and after
any sync:
- `android/app/build.gradle` — debug block `applicationIdSuffix ".nostrpoc2"` +
  `versionNameSuffix` + `resValue "build_config_package"` + the POC `versionCode`.
- `app/config/feature-flags-context.tsx` — `nonCustodialEnabled`,
  `delegatedGrantsEnabled`, `nostrSignerEnabled` all `true` locally (production
  defaults `false`).

**Toolchain:** Node 24 (`~/.nvm/versions/node/v24.18.0/bin` on PATH; `.nvmrc` pins 24,
the system default node 20 fails yarn's engine check). APK builds MUST run inside
`nix develop` with `ENVFILE=.env.local` — out-of-flake builds fail (system java is a
JRE without `javac`; x86_64 ABI hits a clang segfault). Recipe:
`nix develop --command bash -c 'export PATH=<node24>:$PATH ENVFILE=.env.local &&
yarn android:prepareAssets && ./android/gradlew -b ./android/build.gradle
assembleDebug -PreactNativeArchitectures=arm64-v8a "-Dorg.gradle.jvmargs=-Xmx4g"'`.
Delete `android/app/.cxx` first if any out-of-flake build attempt ran (stale CMake
paths). Stage the arm64 APK + a `.sha256` sidecar under `~/Documents/BLINK/btcpay.blink.sv/`.

**Two known-intentional red jest suites — NOT regressions** (red on the fork by design):
- `__tests__/nostr/feature-flag.spec.ts` — expects production default
  `nostrSignerEnabled: false`; the committed POC value is `true`.
- `__tests__/i18n/locale-parity.spec.ts` — new English keys untranslated in other
  locales (translation-pipeline gap).
Any OTHER red suite after a sync is real and must be fixed (usually a merge-era mock
gap — mock the new upstream hook/provider in that spec).

**Sync posture:** merge, never rebase. Dated backup branch + `chore/sync-upstream` +
descriptive merge commit (see `0a1629c21`, `ea673cbd1`). Recurring conflict hotspot is
`app/app.tsx` (provider tree): keep upstream's outer structure, splice the fork's
providers (`NostrRuntimeProvider`, `ApprovalSurfaceHost`, …) back in — drop neither side.
Never hand-edit `app/i18n/i18n-types.ts`; regenerate with `yarn update-translations`.
