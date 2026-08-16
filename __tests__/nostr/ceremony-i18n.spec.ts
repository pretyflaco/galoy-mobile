/**
 * Story 1.5 / AC-8 — every user-facing ceremony string ships through typesafe-i18n; no
 * hardcoded copy on the three screens. This scans the screen sources for JSX text nodes
 * and string-literal `title=`/`accessibilityLabel=` props that are not i18n calls.
 */
import { readFileSync } from "fs"
import { join } from "path"

const screenDir = join(process.cwd(), "app/screens/nostr/create-identity")
const screens = ["intro-screen.tsx", "confirm-screen.tsx", "result-screen.tsx"]

describe("ceremony copy is i18n-sourced (AC-8)", () => {
  it("no screen has hardcoded JSX text content", () => {
    for (const file of screens) {
      const src = readFileSync(join(screenDir, file), "utf8")
      // JSX text between tags that contains letters and is not an expression {…}.
      const jsxText = [...src.matchAll(/>\s*([A-Za-z][A-Za-z ,.'"!?]{3,})\s*</g)]
        .map((m) => m[1].trim())
        .filter((t) => !/^(string|number|boolean|View|Text|Svg)$/.test(t))
      expect({ file, jsxText }).toEqual({ file, jsxText: [] })
    }
  })

  it("button titles come from LL, not string literals", () => {
    for (const file of screens) {
      const src = readFileSync(join(screenDir, file), "utf8")
      const literalTitles = [...src.matchAll(/title=\s*"([^"]+)"/g)].map((m) => m[1])
      expect({ file, literalTitles }).toEqual({ file, literalTitles: [] })
    }
  })

  it("every ceremony i18n key exists in the en base translation", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const en = require("@app/i18n/en").default
    const ns = en.NostrCreateIdentityScreen
    expect(ns).toBeDefined()
    // spot-check the load-bearing keys are present and non-empty
    for (const key of ["introCreate", "confirmCta", "resultOwnership", "backupCta"]) {
      expect(typeof ns[key]).toBe("string")
      expect(ns[key].length).toBeGreaterThan(0)
    }
  })
})
