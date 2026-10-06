/**
 * Story 3.4 — approval copy is i18n-sourced; SR labels/announcements/counter are
 * human-meaning-only (a lint/review gate forbids raw scope `sign_event:22242`, `nip44_decrypt`,
 * or bare kind numbers in any accessible label). No hardcoded strings on the surface.
 */
import { readFileSync } from "fs"
import { join } from "path"

const screen = join(process.cwd(), "app/screens/nostr/request-approval-screen.tsx")

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en = require("@app/i18n/en").default
const ns = en.NostrRequestApprovalScreen

describe("request-approval copy is i18n-sourced (Task 3)", () => {
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
})

describe("SR-label lint gate: no raw scope/kind in accessible labels (AC #4)", () => {
  const RAW_TOKENS = ["sign_event:22242", "nip44_decrypt", "nip04_decrypt", "22242"]

  it("no accessible-label template carries a raw scope / kind token", () => {
    const keys = ["srLabel", "announce", "counter", "keepOpenHint", "waitingCatchUp"]
    for (const key of keys) {
      const template = ns[key] as string
      for (const token of RAW_TOKENS) expect(template).not.toContain(token)
    }
  })

  it("srLabel and announce name the client + human action in human terms", () => {
    expect(ns.srLabel).toContain("{client")
    expect(ns.srLabel).toContain("{action")
    expect(ns.announce).toContain("{client")
    expect(ns.announce).toContain("{action")
  })
})
