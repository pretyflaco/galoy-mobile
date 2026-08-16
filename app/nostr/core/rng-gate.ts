/**
 * RNG release gate (Story 1.8 / AC-2 / NFR-4).
 *
 * Wraps the Story 1.2 `assertSecureRng` semantics as a build/release gate: given a
 * byte source, it verifies the source is non-constant across draws (the real native
 * CSPRNG) and NOT the deterministic Jest-mock pattern. Returns a pass/fail result the
 * CI entrypoint (scripts/rng-release-gate) turns into an exit code, blocking a release
 * that would ship with a deterministic RNG.
 *
 * AD-1: core is UI-free.
 */
export interface RngGateResult {
  ok: boolean
  reason?: string
}

const RNG_GATE_DRAWS = 4

/**
 * Run the gate against an injected byte source (native randomBytes in prod; a stub in
 * tests). Blocks (ok:false) when the draws are constant/identical — the signature of a
 * deterministic RNG or a leaked test mock.
 */
export const runRngGate = (randomBytes: (size: number) => Uint8Array): RngGateResult => {
  const draws: string[] = []
  for (let i = 0; i < RNG_GATE_DRAWS; i += 1) {
    let bytes: Uint8Array
    try {
      bytes = randomBytes(32)
    } catch (e) {
      return {
        ok: false,
        reason: `RNG threw: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
    if (!bytes || bytes.length !== 32) {
      return { ok: false, reason: "RNG returned unusable output (wrong length)" }
    }
    draws.push(Buffer.from(bytes).toString("hex"))
  }

  const allIdentical = draws.every((d) => d === draws[0])
  if (allIdentical) {
    return {
      ok: false,
      reason:
        "RNG produced constant output across draws — deterministic RNG / test mock must " +
        "never reach a release build (NFR-4)",
    }
  }
  return { ok: true }
}
