/**
 * Story 1.1 / AC-6: nsec (private key material) may be read ONLY inside
 * local-nsec-signer.ts and the backup/export module (AD-2 / FR-1). Every other file
 * reaches signatures/npub via the NostrSigner seam. Enforced by an ESLint override
 * (no-restricted-syntax on nsec/privateKeyHex/secretKey identifiers) that excludes
 * those two files.
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
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ESLint } = require("eslint") as {
  ESLint: new (opts: { cwd: string }) => ESLintInstance
}

const makeESLint = (): ESLintInstance => new ESLint({ cwd: process.cwd() })
const nsecViolations = (r: LintResult): LintMessage[] =>
  r.messages.filter((m) => m.ruleId === "no-restricted-syntax")

const nsecCode = `const nsec = "reads key material"\nexport const x = nsec\n`

describe("nsec-read boundary (AC-6)", () => {
  it("a nsec read in an ordinary nostr file FAILS the rule", async () => {
    const results = await makeESLint().lintText(nsecCode, {
      filePath: "app/nostr/transport/pipeline.ts",
    })
    expect(nsecViolations(results[0]).length).toBeGreaterThan(0)
  })

  it("a nsec read in a nostr SCREEN FAILS the rule", async () => {
    const results = await makeESLint().lintText(nsecCode, {
      filePath: "app/screens/nostr/some-screen.ts",
    })
    expect(nsecViolations(results[0]).length).toBeGreaterThan(0)
  })

  it("local-nsec-signer.ts is ALLOWED to read nsec", async () => {
    const results = await makeESLint().lintText(nsecCode, {
      filePath: "app/nostr/core/local-nsec-signer.ts",
    })
    expect(nsecViolations(results[0])).toHaveLength(0)
  })

  it("backup-export.ts is ALLOWED to read nsec", async () => {
    const results = await makeESLint().lintText(nsecCode, {
      filePath: "app/nostr/core/backup-export.ts",
    })
    expect(nsecViolations(results[0])).toHaveLength(0)
  })
})
