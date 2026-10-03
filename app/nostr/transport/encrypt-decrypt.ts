/**
 * Encrypt/decrypt capability flow (Story 3.6 / FR-15 / AD-7 / CAP-5).
 *
 * The four capability ops (nip04/nip44 encrypt/decrypt) each raise their OWN fresh approval
 * through the ApprovalCoordinator seam — no cached consent, no "remember", no reuse across ops
 * (the only ever-remembered consent is the fixed connect-time sign_event:22242 grant, which does
 * NOT cover encrypt/decrypt). The crypto runs ONLY through the NostrSigner seam (nsec confined
 * to LocalNsecSigner).
 *
 * Plaintext/ciphertext NEVER reach the log/analytics sink (AD-7): logging is metadata-only
 * (kind/method, client pubkey, timing) via redact.signerLogFields, and assertNoSecrets guards
 * the emitted payload. AD-1: transport is UI-free.
 */
import type { NostrSigner } from "@app/nostr/core/signer"
import { assertNoSecrets, signerLogFields } from "@app/nostr/core/redact"

/** The four capability methods (FR-15). */
export type CapabilityMethod =
  | "nip04_encrypt"
  | "nip04_decrypt"
  | "nip44_encrypt"
  | "nip44_decrypt"

export interface CapabilityRequest {
  method: CapabilityMethod
  /** The counterparty x-only pubkey hex. */
  peerPubkey: string
  /** The plaintext (encrypt) or ciphertext (decrypt) to operate on. */
  payload: string
}

export interface CapabilityApprovalDecision {
  approved: boolean
}

export interface EncryptDecryptPorts {
  signer: Pick<
    NostrSigner,
    "nip04Encrypt" | "nip04Decrypt" | "nip44Encrypt" | "nip44Decrypt"
  >
  /** Raise a FRESH approval for THIS op through the ApprovalCoordinator (Story 3.4). */
  requestApproval: (request: CapabilityRequest) => Promise<CapabilityApprovalDecision>
  /** Metadata-only log sink. */
  log: (fields: Record<string, string | number>) => void
}

export type CapabilityResult = { ok: true; result: string } | { ok: false; error: string }

export interface EncryptDecryptFlow {
  handle(request: CapabilityRequest): Promise<CapabilityResult>
}

const runOp = (
  signer: EncryptDecryptPorts["signer"],
  request: CapabilityRequest,
): Promise<string> => {
  switch (request.method) {
    case "nip04_encrypt":
      return signer.nip04Encrypt(request.peerPubkey, request.payload)
    case "nip04_decrypt":
      return signer.nip04Decrypt(request.peerPubkey, request.payload)
    case "nip44_encrypt":
      return signer.nip44Encrypt(request.peerPubkey, request.payload)
    case "nip44_decrypt":
      return signer.nip44Decrypt(request.peerPubkey, request.payload)
    default:
      return Promise.reject(new Error("unsupported capability method"))
  }
}

export const createEncryptDecryptFlow = (
  ports: EncryptDecryptPorts,
): EncryptDecryptFlow => {
  const { signer, requestApproval, log } = ports

  return {
    async handle(request: CapabilityRequest): Promise<CapabilityResult> {
      // Metadata-only log entry (never the payload/plaintext). `signerLogFields` projects to
      // the allow-listed metadata keys only — the payload can never reach the sink. The
      // assertNoSecrets guard defends against a forbidden secret-bearing key (AD-7/NFR-3).
      const meta = signerLogFields({
        method: request.method,
        clientPubkey: request.peerPubkey,
      })
      assertNoSecrets(meta)
      log(meta)

      // Each op raises its OWN fresh approval (no cached consent, no reuse).
      const decision = await requestApproval(request)
      if (!decision.approved) return { ok: false, error: "request rejected by user" }

      const result = await runOp(signer, request)
      return { ok: true, result }
    },
  }
}
