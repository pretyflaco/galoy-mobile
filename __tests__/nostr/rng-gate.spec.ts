/**
 * Story 1.8 / AC-2 — RNG release gate blocks a build whose RNG is not the real native
 * source (constant/deterministic output = the Jest mock pattern).
 */
import { runRngGate } from "../../app/nostr/core/rng-gate"

describe("RNG release gate (AC-2 / NFR-4)", () => {
  it("BLOCKS on the deterministic mock's constant output", () => {
    const constant = (size: number) => Buffer.alloc(size, 0xab) // the repo's mock pattern
    const result = runRngGate(constant)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/constant output/)
  })

  it("PASSES for a non-constant (native-shaped) source", () => {
    let n = 0
    const varying = (size: number) => {
      const b = new Uint8Array(size)
      b[0] = n
      n += 1
      return b
    }
    expect(runRngGate(varying).ok).toBe(true)
  })

  it("BLOCKS when the RNG throws (unavailable)", () => {
    const throwing = () => {
      throw new Error("native RNG missing")
    }
    const r = runRngGate(throwing)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/threw/)
  })

  it("BLOCKS on unusable (wrong-length) output", () => {
    const short = () => new Uint8Array(2)
    expect(runRngGate(short).ok).toBe(false)
  })
})
