/**
 * Inbound NIP-46 pipeline (Story 3.2 / AD-1 / AD-16).
 *
 * All inbound kind-24133 traffic flows through ONE pipeline in a fixed, explicit order:
 *
 *   verify (BIP-340, against the claimed author clientPubkey) → decrypt/decode → dispatch
 *
 * The verification stage is EXPLICIT and runs FIRST — decrypt is never called on an event
 * that has not passed verification. This does NOT rely on any implicit/default verification a
 * codec or relay library might apply. Events that fail verification (or are the wrong kind)
 * are dropped SILENTLY — no reply, no surfacing — the same posture as never-connected traffic
 * (AD-16); only a metadata-only log entry is emitted.
 *
 * AD-1: transport is UI-free. The crypto verify, decode, and dispatch are injected ports so
 * the ordering guarantee is structural and unit-testable without relays or the keychain.
 * Logging is metadata-only (redact.ts): never plaintext, ciphertext, or keys.
 */
import type { Event } from "nostr-tools/pure"

import { NIP46_KIND, type DecodedRequest } from "./nip46-codec"

/** Injected ports the pipeline orchestrates. */
export interface InboundPipelinePorts {
  /** BIP-340 verification against the claimed author (nostr-tools verifyEvent). */
  verify: (event: Event) => boolean
  /** Decrypt + decode a verified event into a NIP-46 request (nip46-codec.decodeRequest bound). */
  decode: (event: Event) => DecodedRequest
  /** Handle a decoded request (method handlers + ledger; Tasks 3/4). */
  dispatch: (decoded: DecodedRequest, event: Event) => Promise<void>
  /** Metadata-only log sink. */
  log: (fields: Record<string, string | number>) => void
}

export interface InboundPipeline {
  handleInbound(event: Event): Promise<void>
}

export const createInboundPipeline = (ports: InboundPipelinePorts): InboundPipeline => {
  const { verify, decode, dispatch, log } = ports

  return {
    async handleInbound(event: Event): Promise<void> {
      // Stage 0: shape/kind gate — only kind-24133 is signer traffic.
      if (event.kind !== NIP46_KIND) {
        log({ dropped: "wrong-kind", kind: event.kind })
        return
      }

      // Stage 1: EXPLICIT BIP-340 verify BEFORE decrypt (AD-16). Fail → drop silently.
      if (!verify(event)) {
        log({ dropped: "verify-failed", clientPubkey: event.pubkey })
        return
      }

      // Stage 2: decrypt + decode (only reachable for a verified event).
      const decoded = decode(event)

      // Stage 3: dispatch to the method handlers / ledger.
      await dispatch(decoded, event)
    },
  }
}
