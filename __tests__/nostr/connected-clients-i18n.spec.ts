/**
 * Story 3.7 Task 6 — connected-clients copy is i18n-sourced; the disconnect confirm copy and
 * SR label match the IA/Accessibility Floor. No hardcoded strings on the section.
 */
import { readFileSync } from "fs"
import { join } from "path"

const screen = join(process.cwd(), "app/screens/nostr/connected-clients-section.tsx")

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en = require("@app/i18n/en").default
const ns = en.NostrConnectedClientsScreen

describe("connected-clients copy is i18n-sourced (Task 6)", () => {
  it("the section has no hardcoded JSX text content", () => {
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

  it("the empty-state copy matches the IA", () => {
    expect(ns.empty).toBe("No apps connected yet.")
  })

  it("the confirm body states recoverability (can reconnect with approval)", () => {
    expect(ns.confirmBody).toContain("reconnect with your approval")
  })

  it("the SR label matches the Accessibility Floor pattern (client + reconnect + choice)", () => {
    expect(ns.srLabel).toContain("{client")
    expect(ns.srLabel).toContain("reconnect with your approval")
    expect(ns.srLabel).toContain("Disconnect or cancel")
  })
})
