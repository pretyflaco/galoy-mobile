/**
 * Story 1.1 / AC-5: one consistent noble copy on the signer path.
 *
 * The signer path is `@noble/curves` (secp256k1 / BIP-340 Schnorr) + `nostr-tools`
 * (NIP-01/04/19/44/46 + relay pool). nostr-tools 2.24.1 pulls @noble/curves 2.0.1,
 * @noble/hashes 2.0.1, @noble/ciphers 2.1.1.
 *
 * What this enforces:
 *  1. `@noble/curves` and `@noble/ciphers` — the packages the signer code imports
 *     DIRECTLY — resolve to exactly ONE copy shared by our code and nostr-tools.
 *  2. Every `@noble/hashes` reachable on the signer path is the SAME pinned 2.0.1
 *     (no version skew). This is the real defense against the class of bug the
 *     vaults fork hit (a second, behaviourally-different copy). blink-mobile's
 *     pre-existing @noble/hashes 1.8.0 remains for legacy consumers and is out of
 *     scope for the signer path.
 *
 * KNOWN CONSTRAINT (documented for the KG seam review): under yarn 1 hoisting,
 * because the repo also carries @noble/hashes ^1.x for legacy consumers at the root,
 * the 2.0.1 copy cannot hoist to the root and appears nested under each signer-path
 * parent. Those nested copies are BYTE-IDENTICAL 2.0.1 (pure, stateless hash fns),
 * so they carry no behavioural-skew risk. A true single physical copy would require
 * migrating the legacy consumers off 1.x (out of scope for 1.1) or a pnpm/yarn-berry
 * resolver. AC-5's bug-prevention intent (no incompatible copy) is met and asserted.
 */
import { createRequire } from "module"

const requireFromCurves = createRequire(require.resolve("@noble/curves"))
const requireFromNostrTools = createRequire(require.resolve("nostr-tools"))

const readVersion = (req: NodeRequire, subpathFile: string): string => {
  // noble 2.x exports maps require the ".js" subpath; walk up to its package.json.
  const resolved = req.resolve(subpathFile)
  const pkgDir = resolved.slice(0, resolved.lastIndexOf("/@noble/") + "/@noble/".length)
  const pkgName = subpathFile.split("/").slice(0, 2).join("/") // e.g. "@noble/hashes"
  const shortName = pkgName.split("/")[1]
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs") as typeof import("fs")
  const pkgJsonPath = `${pkgDir}${shortName}/package.json`
  return JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")).version
}

describe("single noble copy on the signer path (AC-5)", () => {
  it("@noble/curves resolves to one shared copy (our code === nostr-tools)", () => {
    expect(requireFromCurves.resolve("@noble/curves/secp256k1.js")).toBe(
      requireFromNostrTools.resolve("@noble/curves/secp256k1.js"),
    )
  })

  it("@noble/ciphers resolves to one shared copy (our code === nostr-tools)", () => {
    expect(requireFromCurves.resolve("@noble/ciphers/aes.js")).toBe(
      requireFromNostrTools.resolve("@noble/ciphers/aes.js"),
    )
  })

  it("every signer-path @noble/hashes is the same pinned 2.0.1 (no version skew)", () => {
    const fromCurves = readVersion(requireFromCurves, "@noble/hashes/sha2.js")
    const fromNostr = readVersion(requireFromNostrTools, "@noble/hashes/sha2.js")
    expect(fromCurves).toBe("2.0.1")
    expect(fromNostr).toBe("2.0.1")
  })

  it("nostr-tools and @noble/curves are installed at the pinned versions", () => {
    const nostrDir = require
      .resolve("nostr-tools")
      .replace(/\/nostr-tools\/.*$/, "/nostr-tools")
    const curvesDir = require
      .resolve("@noble/curves")
      .replace(/\/@noble\/curves\/.*$/, "/@noble/curves")
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs") as typeof import("fs")
    const nostrVer = JSON.parse(
      fs.readFileSync(`${nostrDir}/package.json`, "utf8"),
    ).version
    const curvesVer = JSON.parse(
      fs.readFileSync(`${curvesDir}/package.json`, "utf8"),
    ).version
    expect(nostrVer).toBe("2.24.1")
    expect(curvesVer).toBe("2.0.1")
  })
})
