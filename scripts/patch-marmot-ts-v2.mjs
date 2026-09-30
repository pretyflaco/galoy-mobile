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
//   F-M16-1 — processMessage guard (marmot-ts#78; supersedes the F-M12-2 log-only edit):
//             a non-object result (Hermes: the literal 0) is recovered from the promise,
//             recomputed once, or thrown into the engine's retry path — never silently
//             dropped; anomalies go to globalThis.__marmotIngestAnomaly. Plus a
//             behavior-neutral layer-2 probe in ts-mls processMessage. Unit test:
//             scripts/test-patch-f-m16-1.mjs.
//
// Edits may carry `upgradeFrom`: earlier versions of the same edit that are swapped
// in place (so an installed tree upgrades without a reinstall).
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
  // --- F-M16-1 (marmot-ts#78): the processMessage guard (A′) ----------------------
  // On Hermes, `await processMessage(...)` inside ingest's Babel-lowered async
  // generator has resolved to the literal number 0 (findings/M12, M14, M16). The stock
  // loops have no branch for a non-object result: the envelope is dropped with no log,
  // no disposition and no yield, and the group stalls at its epoch. The guard:
  //   1. watches the promise itself (.then registered before the await) — if the
  //      promise resolved an object but the await produced a non-object, the await path
  //      is at fault and the promise's value is used (same computation, same capture);
  //   2. otherwise recomputes once with a fresh proposal capture (safe: processMessage
  //      does not mutate its input state — copy-on-write secret tree, sliced ratchet
  //      tree, sliced tree-hash cache; verified 2026-10-01);
  //   3. otherwise THROWS, so the envelope takes the engine's own "failed — queued for
  //      retry" path (errors list + bounded retry passes) instead of vanishing.
  // Every anomaly is logged and reported to globalThis.__marmotIngestAnomaly (the app's
  // stuck-conversation detector) or console.warn when no hook is installed.
  {
    file: `${root}engine/ingest.js`,
    find: `function isPermanentDecryptFailure(error) {`,
    replace: `// ${PATCH_MARKER} (F-M16-1): processMessage guard — see scripts/patch-marmot-ts-v2.mjs.
function describeResult(v) {
    return v !== null && typeof v === "object" ? \`object(kind=\${v.kind})\` : \`\${typeof v}(\${String(v)})\`;
}
function reportIngestAnomaly(anomaly) {
    try {
        const hook = globalThis.__marmotIngestAnomaly;
        if (typeof hook === "function")
            hook(anomaly);
        else
            console.warn("[marmot-ts F-M16-1]", JSON.stringify(anomaly));
    }
    catch { }
}
async function processMessageGuarded(makeCapture, makeParams, log, label) {
    for (let attempt = 1; attempt <= 2; attempt++) {
        const capture = makeCapture();
        const params = makeParams(capture.callback);
        const pending = processMessage(params);
        let settled;
        pending.then((v) => { settled = { v }; }, () => { });
        const result = await pending;
        if (result !== null && typeof result === "object")
            return { result, capture };
        const promiseView = settled === undefined ? "unsettled" : describeResult(settled.v);
        const anomaly = {
            kind: "processMessage-non-object",
            envelope: label,
            attempt,
            awaited: describeResult(result),
            promise: promiseView,
            groupId: bytesToHex(params.state.groupContext.groupId),
            epoch: Number(params.state.groupContext.epoch),
        };
        log("envelope:%s F-M16-1 processMessage non-object (attempt %d): await=%s promise=%s", label, attempt, anomaly.awaited, promiseView);
        if (settled !== undefined && settled.v !== null && typeof settled.v === "object") {
            reportIngestAnomaly({ ...anomaly, recovered: "promise-value" });
            return { result: settled.v, capture };
        }
        reportIngestAnomaly(anomaly);
    }
    reportIngestAnomaly({ kind: "processMessage-gave-up", envelope: label });
    throw new Error(\`F-M16-1: processMessage returned a non-object twice for envelope \${label}\`);
}
function isPermanentDecryptFailure(error) {`,
  },
  {
    // the non-commit loop (proposals + application messages)
    file: `${root}engine/ingest.js`,
    find: `            const parentForAuth = ctx.getState();
            const capture = withCapturedProposals(ctx.createAdminCallback(parentForAuth));
            const result = await processMessage({
                context: {
                    cipherSuite: ctx.ciphersuite,
                    authService: marmotAuthService,
                    externalPsks: {},
                },
                state: parentForAuth,
                message,
                callback: capture.callback,
            });
            const captured = capture.take();`,
    replace: `            const parentForAuth = ctx.getState();
            const { result, capture } = await processMessageGuarded(() => withCapturedProposals(ctx.createAdminCallback(parentForAuth)), (callback) => ({
                context: {
                    cipherSuite: ctx.ciphersuite,
                    authService: marmotAuthService,
                    externalPsks: {},
                },
                state: parentForAuth,
                message,
                callback,
            }), log, envelopeLabel(envelope)); // ${PATCH_MARKER} (F-M16-1)
            const captured = capture.take();`,
  },
  {
    // the commit loop. Supersedes the F-M12-2 observability-only edit (upgradeFrom).
    file: `${root}engine/ingest.js`,
    find: `            const parentForAuth = ctx.getState();
            const capture = withCapturedProposals(ctx.createAdminCallback(parentForAuth));
            const result = await processMessage({
                context: {
                    cipherSuite: ctx.ciphersuite,
                    authService: marmotAuthService,
                    externalPsks: {},
                },
                state: parentForAuth,
                message,
                callback: capture.callback,
            });
            const capturedCommit = capture.take();
            if (result.kind === "newState") {`,
    upgradeFrom: [
      `            const parentForAuth = ctx.getState();
            const capture = withCapturedProposals(ctx.createAdminCallback(parentForAuth));
            const result = await processMessage({
                context: {
                    cipherSuite: ctx.ciphersuite,
                    authService: marmotAuthService,
                    externalPsks: {},
                },
                state: parentForAuth,
                message,
                callback: capture.callback,
            });
            const capturedCommit = capture.take();
            if (!result || result.kind !== "newState") // ${PATCH_MARKER} (F-M12-2)
                log("commit envelope:%s NON-NEWSTATE result (stall risk): ctor=%s kind=%s", envelopeLabel(envelope), result?.constructor?.name, result?.kind);
            if (result.kind === "newState") {`,
    ],
    replace: `            const parentForAuth = ctx.getState();
            const { result, capture } = await processMessageGuarded(() => withCapturedProposals(ctx.createAdminCallback(parentForAuth)), (callback) => ({
                context: {
                    cipherSuite: ctx.ciphersuite,
                    authService: marmotAuthService,
                    externalPsks: {},
                },
                state: parentForAuth,
                message,
                callback,
            }), log, envelopeLabel(envelope)); // ${PATCH_MARKER} (F-M16-1)
            const capturedCommit = capture.take();
            if (result.kind !== "newState") // ${PATCH_MARKER} (F-M12-2)
                log("commit envelope:%s NON-NEWSTATE result (stall risk): ctor=%s kind=%s", envelopeLabel(envelope), result?.constructor?.name, result?.kind);
            if (result.kind === "newState") {`,
  },
  {
    // Layer-2 probe (behavior-neutral: the same promise is returned; one extra
    // reaction): does the private-message promise ITSELF resolve a non-object? With
    // the ingest guard's await-vs-promise comparison this bisects where the 0 is born.
    file: `${root}vendor/ts-mls/processMessages.js`,
    find: `    else
        return processPrivateMessage({
            context: { cipherSuite: cs, authService, externalPsks, clientConfig },
            state,
            privateMessage: message.privateMessage,
            callback: action,
        });
}`,
    replace: `    else {
        const pending = processPrivateMessage({
            context: { cipherSuite: cs, authService, externalPsks, clientConfig },
            state,
            privateMessage: message.privateMessage,
            callback: action,
        });
        pending.then((v) => { // ${PATCH_MARKER} (F-M16-1) layer-2 probe
            if (v === null || typeof v !== "object") {
                try {
                    const anomaly = { kind: "processPrivateMessage-non-object", value: \`\${typeof v}(\${String(v)})\` };
                    if (typeof globalThis.__marmotIngestAnomaly === "function") globalThis.__marmotIngestAnomaly(anomaly);
                    else console.warn("[marmot-ts F-M16-1]", JSON.stringify(anomaly));
                }
                catch { }
            }
        }, () => { });
        return pending;
    }
}`,
  },
]

let failed = false
for (const { file, find, replace, upgradeFrom = [] } of edits) {
  const text = readFileSync(file, "utf8")
  if (text.includes(replace)) {
    console.log(`patch-marmot-ts-v2: already patched (${file.split("/dist/")[1]})`)
    continue
  }
  // an earlier version of this edit is in place (e.g. F-M12-2 → F-M16-1): swap it
  const from = [find, ...upgradeFrom].find((f) => text.split(f).length === 2)
  if (!from) {
    console.error(`patch-marmot-ts-v2: DRIFT — pattern not found (or not unique) in ${file}`)
    failed = true
    continue
  }
  writeFileSync(file, text.replace(from, replace))
  console.log(`patch-marmot-ts-v2: ${from === find ? "applied" : "upgraded"} (${file.split("/dist/")[1]})`)
}
if (failed) process.exit(1)
