/**
 * EventSigner for marmot-ts backed by the fork's signer runtime (from poc/support-chat-demo
 * M6, unchanged for P1 — the "Blink form" of the signer). Delegates to LocalNsecSigner
 * through the runtime's first-party methods: the secret never leaves the signer seam.
 *
 * Signs the app's OWN Marmot events (key packages, group events are signed by marmot-ts with
 * ephemeral keys; this key signs rumors, gift wraps' seals and NIP-42 AUTH kind 22242) and
 * opens gift-wrapped invites (NIP-44, required — F-M1-1). Approval policy: first-party, no
 * per-event prompt (same as signAuthEvent for the BTCPay magic-link login) — recorded in
 * findings/M6-demo-apk.md.
 */
import type { EventTemplate, SignedEvent } from "@app/nostr/core/signer"
import type { SignerRuntime } from "@app/nostr/runtime"

export type BlinkEventSigner = {
  getPublicKey: () => Promise<string>
  signEvent: (draft: EventTemplate) => Promise<SignedEvent>
  nip44: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>
  }
}

export const createBlinkEventSigner = async (
  runtime: SignerRuntime,
): Promise<BlinkEventSigner> => {
  const pubkey = await runtime.getPublicKeyHex()
  return {
    getPublicKey: async () => pubkey,
    // The seam derives pubkey, id and sig itself from the template fields.
    signEvent: (template) => runtime.signAuthEvent(template),
    nip44: {
      encrypt: (peer, plaintext) => runtime.nip44EncryptSelf(peer, plaintext),
      decrypt: (peer, ciphertext) => runtime.nip44DecryptSelf(peer, ciphertext),
    },
  }
}
