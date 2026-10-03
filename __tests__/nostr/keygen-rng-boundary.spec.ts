/**
 * Story 1.2 / AC-2 — no weak RNG on the key path. Under app/nostr/core/**, ESLint
 * must forbid: noble's no-arg generator (randomPrivateKey / randomSecretKey),
 * Math.random, and any assignment to global.crypto. This test drives ESLint on
 * fixtures and confirms the real keygen.ts passes.
 */

export {}

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

const lint = new ESLint({ cwd: process.cwd() })
const rngViolations = (r: LintResult): LintMessage[] =>
  r.messages.filter(
    (m) => m.ruleId === "no-restricted-syntax" || m.ruleId === "no-restricted-properties",
  )

const core = (name: string) => `app/nostr/core/${name}.ts`

describe("no weak RNG on the key path (AC-2)", () => {
  it("forbids noble randomPrivateKey() under core/**", async () => {
    const code = `const d = randomPrivateKey()\nexport const x = d\n`
    const res = await lint.lintText(code, { filePath: core("__rng_probe__") })
    expect(rngViolations(res[0]).length).toBeGreaterThan(0)
  })

  it("forbids noble randomSecretKey() under core/**", async () => {
    const code = `const d = randomSecretKey()\nexport const x = d\n`
    const res = await lint.lintText(code, { filePath: core("__rng_probe__") })
    expect(rngViolations(res[0]).length).toBeGreaterThan(0)
  })

  it("forbids Math.random() under core/**", async () => {
    const code = `const d = Math.random()\nexport const x = d\n`
    const res = await lint.lintText(code, { filePath: core("__rng_probe__") })
    expect(rngViolations(res[0]).length).toBeGreaterThan(0)
  })

  it("forbids assigning global.crypto under core/**", async () => {
    const code = `global.crypto = {} as unknown as Crypto\nexport const x = 1\n`
    const res = await lint.lintText(code, { filePath: core("__rng_probe__") })
    expect(rngViolations(res[0]).length).toBeGreaterThan(0)
  })

  it("real app/nostr/core/keygen.ts passes the RNG boundary", async () => {
    const res = await lint.lintFiles([core("keygen")])
    expect(rngViolations(res[0])).toHaveLength(0)
  })
})
