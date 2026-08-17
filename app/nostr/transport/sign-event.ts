/**
 * sign_event parse-stage normalization (Story 3.5 / AC #2 / AD-16).
 *
 * The parse stage performs, IN ORDER, before any approval surface is raised:
 *  1. strip any client-supplied `sig`;
 *  2. reject a client-supplied `pubkey` that mismatches the user npub with a spec error and
 *     NO approval (rejection lives here, ahead of the Story 3.4 approval surface);
 *  3. recompute `id` UNCONDITIONALLY from the normalized fields (never trust a client id);
 *  4. default a missing `created_at` to now.
 *
 * The output is a canonical `UnsignedEvent`. The seam (LocalNsecSigner.signEvent) may ASSERT
 * the event is canonical but MUST NEVER repair it, and the approval surface renders exactly
 * what will be signed — no post-approval mutation.
 *
 * AD-1: transport is UI-free. `now` is injected for deterministic tests.
 */
import { hexToBytes } from "@noble/hashes/utils.js"
import { getEventHash } from "nostr-tools/pure"
import * as nip19 from "nostr-tools/nip19"

import type { NostrSigner, SignedEvent } from "@app/nostr/core/signer"

/** The canonical unsigned event the seam signs (NIP-01 fields + recomputed id). */
export interface CanonicalUnsignedEvent {
  id: string
  pubkey: string
  kind: number
  created_at: number
  tags: string[][]
  content: string
}

/** Raw sign_event params from the wire (all client-supplied fields are untrusted). */
export interface RawSignEventParams {
  kind: number
  content: string
  tags?: string[][]
  created_at?: number
  /** Untrusted: recomputed unconditionally. */
  id?: string
  /** Untrusted: must match the user or the request is rejected. */
  pubkey?: string
  /** Untrusted: always stripped. */
  sig?: string
}

export interface NormalizeContext {
  /** The user's npub (bech32). */
  userNpub: string
  /** Injected clock (seconds) for `created_at` defaulting. */
  now: () => number
}

export type NormalizeResult =
  | { ok: true; event: CanonicalUnsignedEvent }
  | { ok: false; error: string }

/** Decode a user npub to its x-only pubkey hex (lowercase). */
const npubToHex = (npub: string): string => {
  const decoded = nip19.decode(npub)
  return decoded.data as string
}

/**
 * Normalize raw sign_event params into a canonical UnsignedEvent, or reject (spec error, no
 * approval) on a client pubkey mismatch. `sig` is always dropped; `id` is always recomputed.
 */
export const normalizeSignEventParams = (
  params: RawSignEventParams,
  context: NormalizeContext,
): NormalizeResult => {
  const userPubHex = npubToHex(context.userNpub)

  // Reject a mismatching client pubkey BEFORE any approval (AD-16). A hex-form match is
  // required; the identity is always the user's own key.
  if (params.pubkey && params.pubkey.toLowerCase() !== userPubHex.toLowerCase()) {
    return { ok: false, error: "pubkey does not match the signer identity" }
  }

  const createdAt = params.created_at ?? context.now()
  const kind = params.kind
  const tags = params.tags ?? []
  const content = params.content

  // Recompute the id unconditionally from the normalized fields (never trust a client id).
  const id = getEventHash({
    kind,
    // eslint-disable-next-line camelcase
    created_at: createdAt,
    tags,
    content,
    pubkey: userPubHex,
  })

  // `sig` is intentionally never carried onto the canonical event.
  return {
    ok: true,
    event: {
      id,
      pubkey: userPubHex,
      kind,
      // eslint-disable-next-line camelcase
      created_at: createdAt,
      tags,
      content,
    },
  }
}

/** Guard used by the seam boundary: assert an event is canonical (never repair) — AD-16. */
export const assertCanonicalUnsignedEvent = (event: CanonicalUnsignedEvent): void => {
  const recomputed = getEventHash({
    kind: event.kind,
    // eslint-disable-next-line camelcase
    created_at: event.created_at,
    tags: event.tags,
    content: event.content,
    pubkey: event.pubkey,
  })
  if (recomputed !== event.id) {
    throw new Error("non-canonical event reached the signing seam")
  }
  // Touch hexToBytes so the pubkey is well-formed hex (throws on a malformed pubkey).
  hexToBytes(event.pubkey)
}

/** The approval decision surfaced through the ApprovalCoordinator (Story 3.4). */
export interface SignApprovalDecision {
  approved: boolean
}

export interface SignEventFlowPorts {
  /** The signing seam (LocalNsecSigner) — the SOLE signing path (AD-2). */
  signer: Pick<NostrSigner, "signEvent">
  /** The user's npub (bech32) the request is normalized/verified against. */
  userNpub: string
  /** Injected clock (seconds) for created_at defaulting. */
  now: () => number
  /**
   * Raise the sign approval through the ApprovalCoordinator (Story 3.4). Omitted / pre-approved
   * (connect-time grant) callers can pass a decision that is always approved.
   */
  requestApproval: (event: CanonicalUnsignedEvent) => Promise<SignApprovalDecision>
}

export type SignEventResult =
  | { ok: true; event: SignedEvent }
  | { ok: false; error: string }

export interface SignEventFlow {
  handle(params: RawSignEventParams): Promise<SignEventResult>
}

/**
 * The sign_event flow (Story 3.5): normalize (parse stage) → approve (Story 3.4) → sign via the
 * seam → return the signed event. Rejection on a pubkey mismatch happens in normalization,
 * BEFORE any approval. Signing works for ANY kind (no allow-list) and the result verifies
 * against the user npub with standard nostr tooling. The seam ASSERTS the event is canonical
 * and never repairs it (AD-16).
 */
export const createSignEventFlow = (ports: SignEventFlowPorts): SignEventFlow => {
  const { signer, userNpub, now, requestApproval } = ports

  return {
    async handle(params: RawSignEventParams): Promise<SignEventResult> {
      const normalized = normalizeSignEventParams(params, { userNpub, now })
      if (!normalized.ok) return normalized

      const canonical = normalized.event
      // Fresh approval (except the connect-time grant, handled by the coordinator).
      const decision = await requestApproval(canonical)
      if (!decision.approved) return { ok: false, error: "request rejected by user" }

      // Sign ONLY through the seam. The seam recomputes id from the same fields + user key.
      //
      // Hermes note: the canonicality assert and the signing `await` MUST each stand in their own
      // statement/try block — do NOT fold the `await signer.signEvent(...)` into the returned
      // object literal, and do NOT chain the assert inline. On Hermes the folded/flat form
      // mis-binds the awaited result and `handle` returns a non-object (observed as `0`), which
      // reaches the NIP-46 client as an empty response and stalls BTCPay sign-in. Keeping these as
      // discrete statements (below) makes the async result bind correctly. Verified on-device via
      // adb logcat: flat form → sign-result ok:0; this form → signed + approved session.
      let signed: SignedEvent
      try {
        assertCanonicalUnsignedEvent(canonical)
        signed = await signer.signEvent({
          kind: canonical.kind,
          // eslint-disable-next-line camelcase
          created_at: canonical.created_at,
          tags: canonical.tags,
          content: canonical.content,
        })
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "signing failed",
        }
      }
      return { ok: true, event: signed }
    },
  }
}
