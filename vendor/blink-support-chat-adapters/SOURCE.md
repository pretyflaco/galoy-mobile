# Vendored adapters — source record

Snapshot of `packages/adapters` in **blink-support-chat @ 576fd94** (M11 P1).

Consumed as a yarn `file:` dependency (copies, no symlinks — F-M3-1), the same
mechanism as the M6 demo. Re-vendor with:

```sh
cp ~/Documents/BLINK/blink-support-chat/packages/adapters/<file>.js ./
# then re-apply the fork adaptations below
```

## Files (the v2 subset — deep-import them; there is deliberately no index.js)

`encoding.js`, `network.js` (SimplePoolNetwork, NIP-42), `signer.js`
(TestEventSigner — tests/dev only; the app uses `app/support-chat/blink-signer.ts`),
`load-groups.js` (fault-tolerant load, F-M9-7), `roster.js` (verifier with
persistence + snapshot seed, M11), `key-package-publish.js` (ensureDiscoverable,
F-M9-7/F-M9-12), `hermes-crypto-provider.js`, `push-mip05.js` (M18: marmot-push-v1 client —
token encryption to the notification server, owner-signed kind 447/449, record state,
kind 446 triggers; verbatim from blink-support-chat @ 7b6c85a, 10/10 unit tests also pass
against this tree's @noble/nostr-tools copies).

NOT vendored (v1-only or Node-only): `ingestor.js` (GroupIngestor retired on v2 —
the library's connect()/ingestion pool replaces it, M9 retirement table),
`store.js` (node:fs), `index.js` (would pull store.js into the Metro graph),
`async-storage.js` (the app uses the encrypted store instead).

## Fork adaptations vs the POC source

`network.js` (F-M12-2, fork-only): `activity445At` (last kind-445 delivery on any
subscription) and the `onSubClosed` hook feed the app's stall detector; a closed
subscription is logged (`[support-chat-net] sub closed`, a dead sub = missed
messages). The TEMP M12 request/live-event logs were removed in P7. F-M18-7: both hooks were
set on the wrong object (`this` inside the returned `subscribe()`), so neither ever fired
— fixed (`net`); closes caused by our own `unsubscribe()`/`destroy()` no longer count as a
dead subscription.

`hermes-crypto-provider.js` (exactly two):

1. `sha256` imported from `@noble/hashes/sha256.js` (was `sha2.js`): this file
   resolves `@noble/*` from the fork ROOT — the app's own copies (hashes 1.8.0,
   ciphers 2.2.0, curves 2.0.1) under the frozen map
   (`scripts/check-noble-generation.mjs`); `sha2.js` is a 2.x-only path. Same
   algorithms, byte-compatible.
2. `DependencyError`/`bytesToArrayBuffer` imported from
   `@internet-privacy/marmot-ts/mls` (was `ts-mls`): marmot-ts 0.6.0 vendors its
   ts-mls fork; the npm package's classes are distinct from it (M9 porting list
   #7) and the fork does not exist at the app root at all.

Runtime peer dependencies resolve from the app: `nostr-tools` (direct dep),
`@hpke/core`/`@hpke/common` (hoisted via marmot-ts), `@hpke/dhkem-x25519`
(direct dep, added for this file), `@noble/*` (the app's frozen copies),
`@internet-privacy/marmot-ts` (the pinned tarball).

## Gotcha: yarn `file:` COPIES at install time

`node_modules/@blink-support-chat/adapters/` is a copy made when `yarn install`
last ran — editing files here in `vendor/` does NOT reach the bundle until the
copy is refreshed (`cp vendor/blink-support-chat-adapters/<file>.js
node_modules/@blink-support-chat/adapters/` for quick probes, then a full
`yarn install` to make it stick). Found the hard way during F-M12-2
instrumentation (edits silently absent from the built APK).
