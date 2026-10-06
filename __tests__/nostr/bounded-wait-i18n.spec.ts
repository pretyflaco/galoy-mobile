/**
 * Story 3.1 (Task 3) — the bounded-wait copy is i18n-sourced; no hardcoded strings on the
 * bounded-wait view. Enforced by a source scan (the ContextForScreen harness renders copy
 * empty in tests, so behavior is asserted via testIDs and sourcing is enforced here).
 */
import { readFileSync } from "fs"
import { join } from "path"

const view = join(process.cwd(), "app/screens/nostr/bounded-wait-view.tsx")

describe("bounded-wait copy is i18n-sourced (Task 3)", () => {
  it("the view has no hardcoded JSX text content", () => {
    const src = readFileSync(view, "utf8")
    const jsxText = [...src.matchAll(/>\s*([A-Za-z][A-Za-z ,.'"!?]{3,})\s*</g)]
      .map((m) => m[1].trim())
      .filter((t) => !/^(string|number|boolean|View|Text|Svg|Input)$/.test(t))
    expect(jsxText).toEqual([])
  })

  it("button titles come from LL, not string literals", () => {
    const src = readFileSync(view, "utf8")
    const literalTitles = [...src.matchAll(/title=\s*"([^"]+)"/g)].map((m) => m[1])
    expect(literalTitles).toEqual([])
  })

  it("exposes the bounded-wait namespace keys", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const en = require("@app/i18n/en").default
    const ns = en.NostrBoundedWaitScreen
    expect(ns.tryAgain).toBeTruthy()
    expect(ns.cancel).toBeTruthy()
    expect(ns.signOut).toBeTruthy()
    expect(ns.extend).toBeTruthy()
    expect(ns.slowHint).toBeTruthy()
  })
})
