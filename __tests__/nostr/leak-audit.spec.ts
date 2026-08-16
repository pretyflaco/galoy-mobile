/**
 * Story 1.8 / AC-1, AC-3 — automated key-material leak audit (launch criterion, NFR-3).
 *
 * Static scan over the signer source: no secret / plaintext / event-content value may
 * flow into a log / analytics / crash / network sink. A planted-leak fixture proves the
 * audit actually catches leaks; the real signer source must be clean.
 */
import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"

const ROOTS = [join(process.cwd(), "app/nostr"), join(process.cwd(), "app/screens/nostr")]

// The nsec readers sanctioned by the AD-2 boundary. They read the secret to persist/sign/
// back it up — but must still never route it to a SINK; the sink-argument scan below
// applies to them too, so they are NOT excluded from the audit.
const SINK_CALL =
  /(console\.(log|info|warn|error|debug)|\.logEvent|crashlytics\(\)|recordError|reportError|fetch|axios|XMLHttpRequest)\s*\(/
const FORBIDDEN_ARG =
  /\b(nsec|nsecHex|privKeyHex|privateKeyHex|secretKey|plaintext|decrypted|eventContent|ciphertext)\b/

const listFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listFiles(full))
    else if (/\.(ts|tsx)$/.test(entry) && !full.includes("__tests__")) out.push(full)
  }
  return out
}

/** Return sink-call lines whose call (same line) also references a forbidden identifier. */
const auditSource = (src: string): { line: number; text: string }[] => {
  const findings: { line: number; text: string }[] = []
  const lines = src.split("\n")
  lines.forEach((text, i) => {
    // Ignore comments — a doc/comment mentioning the words is not a leak.
    const code = text.replace(/\/\/.*$/, "").replace(/\/\*.*\*\//, "")
    if (SINK_CALL.test(code) && FORBIDDEN_ARG.test(code)) {
      findings.push({ line: i + 1, text: text.trim() })
    }
  })
  return findings
}

describe("static key-material leak audit (AC-1/AC-3)", () => {
  it("the audit CATCHES a planted leak (fixture)", () => {
    const leak = [
      `const nsecHex = "deadbeef"`,
      `console.log("signing with", nsecHex)`, // deliberate leak
      `analytics().logEvent("x", { plaintext: decrypted })`, // deliberate leak
    ].join("\n")
    const findings = auditSource(leak)
    expect(findings.length).toBeGreaterThanOrEqual(2)
  })

  it("a metadata-only sink (no forbidden arg) is NOT flagged", () => {
    const clean = `analytics().logEvent("nostr_identity_ceremony_started")`
    expect(auditSource(clean)).toEqual([])
  })

  it("the real signer source routes NO secret/plaintext/content into any sink", () => {
    const allFindings: { file: string; line: number; text: string }[] = []
    for (const root of ROOTS) {
      for (const file of listFiles(root)) {
        for (const f of auditSource(readFileSync(file, "utf8"))) {
          allFindings.push({ file: file.replace(process.cwd(), ""), ...f })
        }
      }
    }
    // Fail the build (this test) on ANY occurrence, with the leaks listed.
    expect(allFindings).toEqual([])
  })
})
