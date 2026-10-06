/**
 * Story 3.6 Task 3/4 — Review-all copy is i18n-sourced; labels are human-meaning-only (no raw
 * scope/kind); the "no blanket batching" footer is present. No hardcoded strings on the screen.
 */
import { readFileSync } from "fs"
import { join } from "path"

const screen = join(process.cwd(), "app/screens/nostr/review-all-screen.tsx")

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en = require("@app/i18n/en").default
const ns = en.NostrReviewAllScreen

describe("review-all copy is i18n-sourced (Task 3/4)", () => {
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

  it("no accessible-label template carries a raw scope / kind token", () => {
    const keys = ["approveSelectedA11y", "rowA11y", "reviewAll", "footer"]
    const raw = ["sign_event:22242", "nip44_decrypt", "nip04_decrypt", "22242"]
    for (const key of keys) {
      const template = ns[key] as string
      for (const token of raw) expect(template).not.toContain(token)
    }
  })

  it("the footer states no-blanket-batching plainly", () => {
    expect(ns.footer).toContain("never batches")
  })
})
