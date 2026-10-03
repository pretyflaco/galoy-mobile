/**
 * The EventSigner shape marmot-ts needs from the app: sign the app's OWN Marmot events
 * (rumors, gift-wrap seals, NIP-42 AUTH kind 22242) and open gift-wrapped invites (NIP-44,
 * required — F-M1-1). Group events are signed by marmot-ts with ephemeral keys.
 *
 * M19: implemented by the device's own support key (support-key.ts). Until then it was
 * backed by the user's Nostr identity through the signer runtime (M6–M18).
 */
import type { EventTemplate, SignedEvent } from "@app/nostr/core/signer"

export type BlinkEventSigner = {
  getPublicKey: () => Promise<string>
  signEvent: (draft: EventTemplate) => Promise<SignedEvent>
  nip44: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>
  }
}
