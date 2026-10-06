// One @noble generation guard (spec 03 §4 req 16) for the support-chat product build.
//
// What "one generation" can honestly mean on this tree today: the @noble consumers
// span three code generations — Blink app code (curves 2.0.1, ciphers 2.2.0, the
// app's own legacy @noble/hashes 1.8), marmot-ts 0.6.0 (^2.2.0 → 2.4.0, the M9-proven
// set), and applesauce-core's nested 1.x copies (isolated by yarn nesting, benign —
// F-M9-11). A literal single copy per family app-wide is a P1/P2 migration item
// (the app's own hashes 1.8 usage has to move first). What must NOT happen is drift:
// a new nested copy, a version bump, or the marmot trio silently changing — that is
// the F-M6-1 breakage class (code written against one @noble generation running on
// another).
//
// This script freezes the exact post-install map (EXPECTED below) and fails the
// install on ANY deviation: unknown location, unexpected version, or a required
// entry missing (e.g. the marmot-ts tarball not installing). Run with --audit to
// print the current map (used when re-freezing after a deliberate change).
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const NM = new URL("../node_modules/", import.meta.url).pathname
const FAMILIES = ["curves", "ciphers", "hashes"]
const MAX_DEPTH = 14 // node_modules nesting sanity cap

// Frozen map: family -> list of [pathRegex (against path relative to node_modules
// root, no leading ./), exactVersion, required?]. First match wins; a copy matching
// no rule is drift; a required rule with no copy is drift.
//
// FROZEN FROM AUDIT 2026-09-30 (P0 second install, after removing the bare noble
// resolutions — yarn 1 bare resolutions override ranges on EVERY edge, which forced
// marmot-ts onto curves 2.0.1 and was the F-M6-1 hazard class; see
// findings/M10-p0-scaffolding.md). Deliberate changes (library upgrade, pin change)
// re-freeze with --audit and get a findings note.
//
// Map rationale (the M9-proven arrangement, findings/M9-v2.md):
//   root          — the app's own pins: curves 2.0.1, ciphers 2.2.0 (bumped from
//                   2.1.1 as in the M6 demo), hashes 1.8.0 (Blink legacy, P1/P2 item)
//   marmot-ts     — nested 2.4.0 trio: what marmot-ts 0.6.0 (^2.2.0) was proven with
//                   on-device in M9 stage 2
//   nostr-tools   — its own exact pins (ciphers 2.1.1, hashes 2.0.1), naturally
//                   nested; applesauce-core's ~2.19 is resolution-forced to the root
//                   nostr-tools 2.24.1 (F-M6-1), so only one nostr-tools exists
//   @scure, curves— bip32/bip39/curves' own ^2.0.x hashes pins, nested
const EXPECTED = {
  curves: [
    ["^@noble/curves$", "2.0.1", true],
    ["^@internet-privacy/marmot-ts/node_modules/@noble/curves$", "2.4.0", true],
  ],
  ciphers: [
    ["^@noble/ciphers$", "2.2.0", true],
    ["^@internet-privacy/marmot-ts/node_modules/@noble/ciphers$", "2.4.0", true],
    ["^nostr-tools/node_modules/@noble/ciphers$", "2.1.1"],
  ],
  hashes: [
    ["^@noble/hashes$", "1.8.0", true],
    ["^@internet-privacy/marmot-ts/node_modules/@noble/hashes$", "2.4.0", true],
    ["^@noble/curves/node_modules/@noble/hashes$", "2.0.1"],
    ["^@scure/bip32/node_modules/@noble/hashes$", "2.0.1"],
    ["^@scure/bip39/node_modules/@noble/hashes$", "2.0.1"],
    ["^nostr-tools/node_modules/@noble/hashes$", "2.0.1"],
  ],
}

const audit = process.argv.includes("--audit")

function walk(dir, depth) {
  const found = []
  if (depth > MAX_DEPTH) return found
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === ".bin" || e.name === ".cache") continue
    const p = join(dir, e.name)
    if (e.name === "@noble") {
      for (const fam of readdirSync(p, { withFileTypes: true })) {
        if (!fam.isDirectory() || !FAMILIES.includes(fam.name)) continue
        const pkg = join(p, fam.name, "package.json")
        try {
          const version = JSON.parse(readFileSync(pkg, "utf8")).version
          found.push({ rel: relative(NM, join(p, fam.name)), family: fam.name, version })
        } catch {
          found.push({ rel: relative(NM, join(p, fam.name)), family: fam.name, version: "???" })
        }
      }
    }
    found.push(...walk(p, depth + 1))
  }
  return found
}

if (!statSync(NM).isDirectory()) {
  console.error("check-noble-generation: no node_modules — run after install")
  process.exit(1)
}

const found = walk(NM, 0).sort((a, b) => a.family.localeCompare(b.family) || a.rel.localeCompare(b.rel))

if (audit || EXPECTED.curves.length === 0) {
  if (EXPECTED.curves.length === 0 && !audit) {
    console.log("check-noble-generation: EXPECTED table not frozen — printing audit map, NOT enforcing.")
    console.log("check-noble-generation: freeze the table in scripts/check-noble-generation.mjs, then re-run.")
  }
  for (const f of found) console.log(`  @noble/${f.family}  ${f.version.padEnd(8)} ${f.rel}`)
  console.log(`check-noble-generation: audit — ${found.length} copies`)
  process.exit(0)
}

const problems = []
for (const family of FAMILIES) {
  const rules = EXPECTED[family] || []
  const copies = found.filter((f) => f.family === family)
  for (const copy of copies) {
    const rule = rules.find(([re]) => new RegExp(re).test(copy.rel))
    if (!rule) {
      problems.push(`@noble/${family}@${copy.version} at ${copy.rel}: no matching rule (new copy?)`)
    } else if (rule[1] !== copy.version) {
      problems.push(`@noble/${family} at ${copy.rel}: ${copy.version}, expected ${rule[1]}`)
    }
  }
  rules.forEach(([re, version, required], i) => {
    if (required && !copies.some((c) => new RegExp(re).test(c.rel) && c.version === version)) {
      problems.push(`@noble/${family}: required ${version} matching /${re}/ missing (dep not installed?)`)
    }
  })
}

if (problems.length) {
  console.error("check-noble-generation: DRIFT — @noble tree no longer matches the frozen map:")
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error("check-noble-generation: if this change is deliberate, re-freeze with --audit and write a findings note.")
  process.exit(1)
}
console.log(`check-noble-generation: OK — ${found.length} @noble copies match the frozen map`)
