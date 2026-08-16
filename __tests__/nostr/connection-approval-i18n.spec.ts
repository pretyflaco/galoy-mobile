/**
 * Story 3.3 Task 11 — connection-approval copy is i18n-sourced; the SR label is
 * human-meaning-only (never raw scope / kind); no hardcoded strings on the screen.
 */
import { readFileSync } from "fs"
import { join } from "path"

const screen = join(process.cwd(), "app/screens/nostr/connection-approval-screen.tsx")

describe("connection-approval copy is i18n-sourced (Task 11)", () => {
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

  it("the SR label template is human-meaning-only (no raw scope / kind) and names the client", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const en = require("@app/i18n/en").default
    const ns = en.NostrConnectionApprovalScreen
    // The raw source export is the template string (the LL proxy compiles it to a fn).
    const template = ns.srLabel as string
    expect(template).toContain("{client")
    expect(template).toContain("sign you in and sign events on your behalf")
    expect(template).toContain("Approve or reject")
    expect(template).not.toContain("sign_event")
    expect(template).not.toContain("22242")
  })

  it("the body copy is human-meaning-only (no raw scope)", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const en = require("@app/i18n/en").default
    const ns = en.NostrConnectionApprovalScreen
    expect(ns.body).not.toContain("sign_event")
    expect(ns.body).not.toContain("22242")
  })
})
