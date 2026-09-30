// Postinstall patch for @internet-privacy/marmot-ts 0.6.0 (master 64e195a, installed
// from the pinned tarball ../lib-pins/internet-privacy-marmot-ts-0.6.0-64e195a.tgz).
//
// Carries the three M9-proven patches (findings/M9-v2.md in blink-support-chat):
//   F-M9-1  — cryptoProvider forwarding: MarmotClient does not pass
//             options.cryptoProvider into KeyPackageManager, KeyPackagePublisher does
//             not pass its provider into createKeyPackageEvent, and
//             createKeyPackageEventInternal drops it for calculateKeyPackageRef —
//             key packages silently fall back to WebCrypto and keyPackages.create()
//             throws on Hermes (upstream marmot-ts#77, still open on master).
//   F-M9-13 — strip GREASE from capabilities.proposals in defaultCapabilities():
//             MDK exact-matches the kind-30443 mls_proposals tag against the leaf's
//             full proposals capability (no GREASE filtering on proposals), so a
//             GREASEd proposal makes White Noise reject the key package.
//   F-M9-14 — last_resort alignment: v2 marks it as the empty-data component 0x0004
//             in a KP-level app_data_dictionary, alongside the legacy MLS extension
//             0x000a for v1 readers (MDK tolerates both).
//
// NOT included, deliberately: the 0x800b (encrypted-media v2) false-advertise probe —
// advertising an unimplemented codec must not ship (F-M9-14 probe, product consequence).
//
// Idempotent; fails the install loudly on drift (same policy as the POC's scripts).
// Edit blocks are byte-identical to the M9 spike script
// (/tmp/opencode/v2-spike/app-v2/scripts/patch-marmot-ts-v2.mjs, mirrored in
// blink-support-chat findings/m9/m9-spike-patch-F-M9-1.diff) — do not reword the
// replaced code comments: the idempotency check matches on them.
import { readFileSync, writeFileSync } from "node:fs"

const root = new URL("../node_modules/@internet-privacy/marmot-ts/dist/", import.meta.url).pathname
const PATCH_MARKER = "M9 spike patch"

const edits = [
  {
    file: `${root}client/marmot-client.js`,
    find: `        this.keyPackages = new KeyPackageManager({
            store: options.keyPackageStore,
            signer: options.signer,
            network: options.network,
            clientId: options.clientId,
            verifyEvent,
        });`,
    replace: `        this.keyPackages = new KeyPackageManager({
            store: options.keyPackageStore,
            signer: options.signer,
            network: options.network,
            clientId: options.clientId,
            verifyEvent,
            cryptoProvider: options.cryptoProvider, // ${PATCH_MARKER} (F-M9-1)
        });`,
  },
  {
    file: `${root}client/key-package-publisher.js`,
    find: `        const eventTemplate = await createKeyPackageEvent({
            keyPackage: options.keyPackage,
            identifier: options.identifier,
            relays: options.relays,
            client: options.client,
            protected: options.protected,
        });`,
    replace: `        const eventTemplate = await createKeyPackageEvent({
            keyPackage: options.keyPackage,
            identifier: options.identifier,
            relays: options.relays,
            client: options.client,
            protected: options.protected,
            cryptoProvider: this.#cryptoProvider, // ${PATCH_MARKER} (F-M9-1)
        });`,
  },
  {
    file: `${root}core/default-capabilities.js`,
    find: `  // Only include "basic" credential type (remove "x509" since we don't support it)`,
    replace: `  // M9 spike patch (F-M9-13): MDK exact-matches the event's mls_proposals tag
  // against the leaf's FULL proposals capability (no GREASE filtering on the MDK
  // side), while the tag writer drops GREASE — a GREASEd proposal makes White
  // Noise reject the key package. Strip GREASE from proposals.
  capabilities.proposals = capabilities.proposals.filter((p) => !isGreaseValue(p));
  // Only include "basic" credential type (remove "x509" since we don't support it)`,
  },
  {
    file: `${root}core/extensions.js`,
    find: `import { makeCustomExtension } from "../vendor/ts-mls/index.js";`,
    replace: `import { makeCustomExtension, makeAppDataDictionaryExtension } from "../vendor/ts-mls/index.js"; // M9 spike patch (F-M9-14)`,
  },
  {
    file: `${root}core/extensions.js`,
    find: `    return [
        ...extensions,
        makeCustomExtension({
            extensionType: LAST_RESORT_EXTENSION_TYPE,
            extensionData: new Uint8Array(0),
        }),
    ];
}`,
    replace: `    // M9 spike patch (F-M9-14): v2 marks last_resort as the empty-data
    // last_resort_key_package app component (0x0004) in a KP-level
    // app_data_dictionary (refs/marmot/foundation/key-packages.md L55); keep the
    // legacy MLS extension 0x000a alongside for v1 readers.
    return [
        ...extensions,
        makeCustomExtension({
            extensionType: LAST_RESORT_EXTENSION_TYPE,
            extensionData: new Uint8Array(0),
        }),
        makeAppDataDictionaryExtension([{ componentId: 4, data: new Uint8Array(0) }]),
    ];
}`,
  },
  {
    file: `${root}core/key-package-event-encode.js`,
    find: `const keyPackageRef = await calculateKeyPackageRef(keyPackage);`,
    replace: `const keyPackageRef = await calculateKeyPackageRef(keyPackage, options.cryptoProvider); // ${PATCH_MARKER} (F-M9-1)`,
  },
]

let failed = false
for (const { file, find, replace } of edits) {
  const text = readFileSync(file, "utf8")
  if (text.includes(replace)) {
    console.log(`patch-marmot-ts-v2: already patched (${file.split("/dist/")[1]})`)
    continue
  }
  if (!text.includes(find)) {
    console.error(`patch-marmot-ts-v2: DRIFT — pattern not found in ${file}`)
    failed = true
    continue
  }
  writeFileSync(file, text.replace(find, replace))
  console.log(`patch-marmot-ts-v2: applied (${file.split("/dist/")[1]})`)
}
if (failed) process.exit(1)
