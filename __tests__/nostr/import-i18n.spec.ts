/**
 * Story 1.6 / AC-1,2 (Task 7) — import copy is i18n-sourced; the verbatim consequence and
 * the replace-identity SR label match EXACTLY; no hardcoded strings on the import screen.
 */
import { readFileSync } from "fs"
import { join } from "path"

const screen = join(
  process.cwd(),
  "app/screens/nostr/import-identity/import-identity-screen.tsx",
)

const VERBATIM =
  "This replaces the identity on this account. The current key will be permanently discarded and cannot be recovered unless you backed it up."
const SR_LABEL =
  "Replace the identity on this account. The current key is permanently discarded. Confirm or cancel."

describe("import copy is i18n-sourced (AC-1/AC-2)", () => {
  it("the screen has no hardcoded JSX text content", () => {
    const src = readFileSync(screen, "utf8")
    const jsxText = [...src.matchAll(/>\s*([A-Za-z][A-Za-z ,.'"!?]{3,})\s*</g)]
      .map((m) => m[1].trim())
      .filter((t) => !/^(string|number|boolean|View|Text|Svg|Input)$/.test(t))
    expect(jsxText).toEqual([])
  })

  it("button titles come from LL, not string literals", () => {
    const src = readFileSync(screen, "utf8")
    const literalTitles = [...src.matchAll(/title=\s*"([^"]+)"/g)].map((m) => m[1])
    expect(literalTitles).toEqual([])
  })

  it("the verbatim consequence and SR label match the spec exactly", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const en = require("@app/i18n/en").default
    const ns = en.NostrImportIdentityScreen
    expect(ns.replaceConsequence).toBe(VERBATIM)
    expect(ns.replaceSrLabel).toBe(SR_LABEL)
    expect(ns.invalidBody).toContain("Your current identity is unchanged")
  })
})
