/**
 * Story 1.1 / AC-4: `app/nostr/core/**` must have ZERO React / React Native / UI
 * imports (AD-1). Enforced by an ESLint `no-restricted-imports` override scoped to
 * app/nostr/core. This test drives ESLint programmatically:
 *  - a deliberate React import inside core/ FAILS the boundary rule;
 *  - a react import outside core (hooks/) PASSES;
 *  - the real core/signer.ts has no restricted-import violations.
 */

export {}

// eslint has no bundled types in this repo; declare the minimal surface we use.
interface LintMessage {
  ruleId: string | null
}
interface LintResult {
  messages: LintMessage[]
}
interface ESLintInstance {
  lintText(code: string, opts: { filePath: string }): Promise<LintResult[]>
  lintFiles(patterns: string[]): Promise<LintResult[]>
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ESLint } = require("eslint") as {
  ESLint: new (opts: { cwd: string }) => ESLintInstance
}

const makeESLint = (): ESLintInstance => new ESLint({ cwd: process.cwd() })
const restrictedOf = (r: LintResult): LintMessage[] =>
  r.messages.filter((m) => m.ruleId === "no-restricted-imports")

describe("no-React-in-core boundary (AC-4)", () => {
  it("flags a React import inside app/nostr/core/**", async () => {
    const code = `import * as React from "react"\nexport const x = React\n`
    const results = await makeESLint().lintText(code, {
      filePath: "app/nostr/core/__boundary_probe__.ts",
    })
    expect(restrictedOf(results[0]).length).toBeGreaterThan(0)
  })

  it("allows a react import OUTSIDE core (e.g. hooks/)", async () => {
    const code = `import * as React from "react"\nexport const x = React\n`
    const results = await makeESLint().lintText(code, {
      filePath: "app/nostr/hooks/__boundary_probe__.ts",
    })
    expect(restrictedOf(results[0])).toHaveLength(0)
  })

  it("real app/nostr/core/signer.ts has no restricted-import violations", async () => {
    const results = await makeESLint().lintFiles(["app/nostr/core/signer.ts"])
    expect(restrictedOf(results[0])).toHaveLength(0)
  })
})
