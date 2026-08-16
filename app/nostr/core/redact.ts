/**
 * Leak-safe logging guard for the signer/pipeline (Story 1.3 / AD-7 / NFR-3).
 *
 * The signer path may log ONLY metadata (NIP-46 kind, client/request-origin pubkey,
 * request id, timing/duration). It MUST NOT emit nsec, transport secret, decrypted
 * plaintext, event content, or ciphertext bodies to any log, analytics event, crash
 * payload, or non-backup network payload.
 *
 * `signerLogFields` projects an arbitrary object down to the allow-listed metadata keys.
 * `assertNoSecrets` is a defensive guard (used in tests and, later, at log sinks) that
 * throws if a payload contains a known secret value or a forbidden secret-bearing key.
 * Story 1.8 leak-audit independently verifies AC-4; this is the in-story guard.
 * AD-1: core is UI-free.
 */

/** The only keys the signer path is permitted to log. */
export const ALLOWED_LOG_KEYS = [
  "kind",
  "clientPubkey",
  "requestId",
  "durationMs",
] as const

export type SignerLogFields = Partial<
  Record<(typeof ALLOWED_LOG_KEYS)[number], string | number>
>

/** Keys that must never appear in any logged/emitted payload. */
const FORBIDDEN_KEYS = [
  "nsec",
  "privateKeyHex",
  "secretKey",
  "transportKey",
  "plaintext",
  "content",
  "ciphertext",
  "sig",
]

/** Project an object down to the allow-listed metadata keys, dropping everything else. */
export const signerLogFields = (input: Record<string, unknown>): SignerLogFields => {
  const out: SignerLogFields = {}
  for (const key of ALLOWED_LOG_KEYS) {
    const value = input[key]
    if (typeof value === "string" || typeof value === "number") {
      out[key] = value
    }
  }
  return out
}

const containsSecret = (value: unknown, secrets: string[]): boolean => {
  if (typeof value === "string") {
    return secrets.some((s) => s.length > 0 && value.includes(s))
  }
  if (Array.isArray(value)) {
    return value.some((v) => containsSecret(v, secrets))
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(k)) return true
      if (containsSecret(v, secrets)) return true
    }
  }
  return false
}

/**
 * Throw if `payload` contains any known secret value or a forbidden secret-bearing key.
 * `secrets` are exact known-sensitive strings (e.g. the nsec/transport hex, plaintext).
 */
export const assertNoSecrets = (
  payload: unknown,
  opts: { secrets?: string[] } = {},
): void => {
  const secrets = opts.secrets ?? []
  if (containsSecret(payload, secrets)) {
    throw new Error(
      "leak-safe logging violation: payload contains key material / plaintext / content (AD-7/NFR-3)",
    )
  }
}
