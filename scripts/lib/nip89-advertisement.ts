/**
 * NIP-89 (kind-31990) signer advertisement — pure builder + author cross-check (Story 4.1).
 *
 * AD-15: the advertisement is OPS-OWNED. This module is the PURE, key-material-free core —
 * it BUILDS the unsigned kind-31990 Handler Information event and CROSS-CHECKS an author
 * against `/.well-known/nostr.json`. It performs NO signing, holds NO nsec, and does NO
 * network I/O. Signing (with the ops nsec from secret storage) and publishing happen only in
 * `scripts/publish-nip89-advertisement.ts`, run from CI/ops — never from a user device, never
 * bundled into the mobile app. Nothing under `app/` imports this.
 *
 * The advertisement identifies blink-mobile as a NIP-46 remote signer so ecosystem clients can
 * offer "sign in with Blink" (FR-17 / CAP-9). Author verifiability: the event `pubkey` must
 * equal the Blink-controlled domain's `nostr.json` `names["_"]` (AD-15).
 */

/** NIP-89 Handler Information kind (nostr-tools `Handlerinformation`). */
export const NIP89_HANDLER_KIND = 31990

/** NIP-46 / NostrConnect kind — the capability this handler advertises (nostr-tools `NostrConnect`). */
export const NIP46_KIND = 24133

/** Default handler identifier (the parameterized-replaceable `d` tag value). */
const DEFAULT_IDENTIFIER = "blink-signer"

/** Profile-like metadata identifying the signer (NIP-89 content shape). */
export interface AdvertisementMetadata {
  name: string
  // eslint-disable-next-line camelcase
  display_name?: string
  about?: string
  picture?: string
  [key: string]: unknown
}

/** An unsigned NIP-01 event template (the builder never signs). */
export interface UnsignedAdvertisement {
  kind: number
  pubkey: string
  // eslint-disable-next-line camelcase
  created_at: number
  tags: string[][]
  content: string
}

export interface BuildAdvertisementInput {
  /** The ops app-identity x-only pubkey (hex). The builder never derives this from a key. */
  pubkey: string
  metadata: AdvertisementMetadata
  /** Kinds this handler serves; defaults to [24133] (NIP-46). Not frozen — overridable. */
  handledKinds?: number[]
  /** The `d` tag value (parameterized-replaceable identity). */
  identifier?: string
  /** Injected clock (seconds) — keeps the builder deterministic/testable. */
  createdAt: number
}

/**
 * Build the unsigned kind-31990 signer advertisement. Pure and deterministic: same inputs →
 * same template. Carries a `d` identity tag, one `k` tag per handled kind (default `24133`
 * marks it a NIP-46 signer), and JSON metadata content. No signing, no nsec, no network.
 */
export const buildSignerAdvertisement = (
  input: BuildAdvertisementInput,
): UnsignedAdvertisement => {
  const { pubkey, metadata, createdAt } = input
  const identifier = input.identifier ?? DEFAULT_IDENTIFIER
  const handledKinds = input.handledKinds ?? [NIP46_KIND]

  const tags: string[][] = [
    ["d", identifier],
    ...handledKinds.map((kind) => ["k", String(kind)]),
  ]

  return {
    kind: NIP89_HANDLER_KIND,
    pubkey,
    // eslint-disable-next-line camelcase
    created_at: createdAt,
    tags,
    content: JSON.stringify(metadata),
  }
}

/** The `/.well-known/nostr.json` shape (only the `names` map is needed for the cross-check). */
export interface NostrJson {
  names: Record<string, string>
}

/**
 * Cross-check the advertisement author (AC #3 / AD-15): the event `pubkey` must equal the
 * Blink-controlled domain's `nostr.json` `names["_"]` hex pubkey. A spoofed author (mismatch)
 * or a missing name entry fails. The domain that serves `nostr.json` is an OPEN SPEC dependency
 * (SPEC line 88) — it is not encoded here; the caller supplies the fetched `nostr.json`.
 */
export const verifyAdvertisementAuthor = (
  event: { pubkey: string },
  nostrJson: NostrJson,
  name = "_",
): boolean => {
  const claimed = nostrJson?.names?.[name]
  return Boolean(claimed) && claimed.toLowerCase() === event.pubkey.toLowerCase()
}

// ---------------------------------------------------------------------------
// Ops sign path (called ONLY by the publish script; nsec comes from ops secret storage).
// The signing primitive (`finalize`) is injected so this module needs no nostr-tools import
// and stays trivially testable with a fixture key — no real ops key material in tests.
// ---------------------------------------------------------------------------

/** A finalized (signed) NIP-01 event. */
export interface SignedAdvertisement extends UnsignedAdvertisement {
  id: string
  sig: string
}

/** The nostr-tools `finalizeEvent` shape, injected so this file imports no crypto. */
export type FinalizeEvent = (
  event: {
    kind: number
    // eslint-disable-next-line camelcase
    created_at: number
    tags: string[][]
    content: string
  },
  sk: Uint8Array,
) => SignedAdvertisement

export interface PrepareForPublishInput {
  /** Reads the ops advertisement nsec as hex (from ops env/secret storage). */
  readNsecHex: () => string
  metadata: AdvertisementMetadata
  handledKinds?: number[]
  identifier?: string
  createdAt: number
  /** Injected nostr-tools `finalizeEvent`. */
  finalize: FinalizeEvent
}

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.trim().toLowerCase()
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Build + sign the advertisement with the ops nsec (called only by the ops publish script).
 * REFUSES to run (throws) if the ops secret is absent — no unsigned/anonymous publish. The
 * signed event's `pubkey` is derived by `finalize` from the nsec, so the nostr.json cross-check
 * passes for the ops identity. Never invoked from mobile code (AD-15).
 */
export const prepareAdvertisementForPublish = (
  input: PrepareForPublishInput,
): SignedAdvertisement => {
  const nsecHex = input.readNsecHex()
  if (!nsecHex || nsecHex.length < 64) {
    throw new Error(
      "NIP-89 publish refused: ops advertisement nsec is absent (set NOSTR_SIGNER_ADVERT_NSEC in ops secret storage).",
    )
  }
  const sk = hexToBytes(nsecHex)
  // finalize derives the pubkey + id + sig; the builder's pubkey placeholder is not used here.
  const unsigned = buildSignerAdvertisement({
    pubkey: "",
    metadata: input.metadata,
    handledKinds: input.handledKinds,
    identifier: input.identifier,
    createdAt: input.createdAt,
  })
  return input.finalize(
    {
      kind: unsigned.kind,
      // eslint-disable-next-line camelcase
      created_at: unsigned.created_at,
      tags: unsigned.tags,
      content: unsigned.content,
    },
    sk,
  )
}
