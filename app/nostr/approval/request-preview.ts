/**
 * Structured "what will be signed / decrypted" preview builders (B4).
 *
 * UI-free (AD-1) and leak-safe (NFR-3 / leak-audit gate): these project a request into the
 * fields the approval surface renders. For sign_event that is the event's kind / created_at /
 * content / tags — the client already sent these to be signed, so showing them reveals nothing
 * new. For encrypt/decrypt it is METADATA ONLY (operation + counterparty + payload length) —
 * the plaintext/ciphertext payload is NEVER placed in the preview, so it can never reach a
 * label, log, or crash report.
 */

/** The structured sign_event preview the request-approval surface renders. */
export interface SignEventPreview {
  kind: number
  createdAt: number
  content: string
  tags: string[][]
}

/** A single unsigned event shape the builder reads (a subset of CanonicalUnsignedEvent). */
export interface PreviewableEvent {
  kind: number
  // eslint-disable-next-line camelcase
  created_at: number
  content: string
  tags: string[][]
}

/** Content longer than this is truncated in the preview (the full event is still what's signed). */
export const PREVIEW_CONTENT_MAX = 500

/**
 * Tags beyond this count are elided from the summary panel with a "+N more" marker (issue #1:
 * a kind:3 contact list carries hundreds of `p` tags and made the approval surface unusable).
 * The exact, unelided event stays available via `formatSignEventPanelFull`.
 */
export const PREVIEW_TAG_RENDER_MAX = 20

/** Render a tags array as the multi-line JSON block shared by both panel formats. */
const renderTags = (tags: string[][]): string =>
  tags.length ? `[\n${tags.map((t) => `  ${JSON.stringify(t)}`).join(",\n")}\n]` : "[]"

/** Build the sign_event preview: the exact fields being signed, content bounded for display. */
export const buildSignEventPreview = (event: PreviewableEvent): SignEventPreview => ({
  kind: event.kind,
  // eslint-disable-next-line camelcase
  createdAt: event.created_at,
  content:
    event.content.length > PREVIEW_CONTENT_MAX
      ? `${event.content.slice(0, PREVIEW_CONTENT_MAX)}…`
      : event.content,
  tags: event.tags,
})

/**
 * Serialize a sign_event preview into the monospace panel text (kind / created_at / content /
 * tags), one field per line. Kept deterministic so the surface + tests share one format.
 * Summary-bounded (issue #1): only the first `PREVIEW_TAG_RENDER_MAX` tags render, with a
 * "+N more" marker — the full panel below carries the exact unelided event.
 */
export const formatSignEventPanel = (p: SignEventPreview): string => {
  const shown = p.tags.slice(0, PREVIEW_TAG_RENDER_MAX)
  const hidden = p.tags.length - shown.length
  const lines = [
    `kind: ${p.kind}`,
    `created_at: ${p.createdAt}`,
    `content: ${JSON.stringify(p.content)}`,
    `tags: ${renderTags(shown)}`,
  ]
  if (hidden > 0) lines.push(`… +${hidden} more tags`)
  return lines.join("\n")
}

/**
 * The EXACT panel (SM-C3): full content (never truncated) and every tag, straight off the event
 * being signed. This is what the approval surface's "View raw event" expander renders, so the
 * exactness rule holds even when the default view is the bounded summary above.
 */
export const formatSignEventPanelFull = (event: PreviewableEvent): string =>
  [
    `kind: ${event.kind}`,
    // eslint-disable-next-line camelcase
    `created_at: ${event.created_at}`,
    `content: ${JSON.stringify(event.content)}`,
    `tags: ${renderTags(event.tags)}`,
  ].join("\n")

/** NIP-46 capability methods that carry a payload we must NOT surface. */
type CapabilityMethod =
  | "nip04_encrypt"
  | "nip04_decrypt"
  | "nip44_encrypt"
  | "nip44_decrypt"

/** first8:last8 of a pubkey — the disambiguating fingerprint (never the full key as a hero). */
const pubkeyPair = (pubkey: string): string =>
  pubkey.length >= 16 ? `${pubkey.slice(0, 8)}:${pubkey.slice(-8)}` : pubkey

/**
 * Build the capability (encrypt/decrypt) preview — METADATA ONLY. States the operation and the
 * counterparty fingerprint; NEVER includes the payload plaintext/ciphertext (leak-audit gate).
 */
export const buildCapabilityPreview = (
  method: CapabilityMethod,
  peerPubkey: string,
): string => {
  const peer = pubkeyPair(peerPubkey)
  switch (method) {
    case "nip04_encrypt":
    case "nip44_encrypt":
      return `Encrypt a message to ${peer}`
    case "nip04_decrypt":
    case "nip44_decrypt":
      return `Decrypt a message from ${peer}`
  }
}
