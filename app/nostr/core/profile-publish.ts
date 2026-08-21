/**
 * Profile picture publish (kind-0 `picture`) + NIP-96 upload auth — pure helpers.
 *
 * The identity's profile photo is the `picture` field of its kind-0 profile-metadata event
 * (NIP-01). Images are uploaded to a NIP-96 media server (POC: nostr.build), whose upload
 * endpoint is guarded by NIP-98 HTTP auth: a locally-signed kind-27235 event bound to the
 * upload URL + POST, base64-encoded into the `Authorization: Nostr <…>` header.
 *
 * AD-1: core is UI-free; signing happens through the runtime seam, network at the edge.
 */
import { PROFILE_INDEXER_RELAYS } from "./profile-relays"

/** Where kind-0 profile updates go: the write-capable indexers + big general relays. */
export const PROFILE_PUBLISH_RELAYS: string[] = [
  ...PROFILE_INDEXER_RELAYS,
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
]

/** NIP-98 auth kind (shared with the login path). */
const NIP98_KIND = 27235

/** POC media host: nostr.build's NIP-96 upload endpoint. */
export const NIP96_UPLOAD_URL = "https://nostr.build/api/v2/nip96/upload"

/** Event template for the NIP-98 upload-auth event (bound to the upload endpoint).
 *  `payloadSha256Hex` is the file's hash — strict NIP-96 servers (nostr.build) reject the
 *  upload without it. */
export const buildUploadAuthTemplate = (uploadUrl: string, payloadSha256Hex: string) => ({
  kind: NIP98_KIND,
  // eslint-disable-next-line camelcase
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["u", uploadUrl],
    ["method", "POST"],
    ["payload", payloadSha256Hex],
  ],
  content: "",
})

/**
 * Build the kind-0 profile-metadata template. `existingContent` is the raw content of the
 * identity's CURRENT kind-0 (if any) — merged so a picture update never clobbers other
 * fields (name, about, …) a foreign client may have set. Malformed/absent → fresh object.
 */
export const buildProfileMetadataTemplate = (
  pictureUrl: string,
  existingContent: string | null,
) => {
  let meta: Record<string, unknown> = {}
  if (existingContent) {
    try {
      const parsed = JSON.parse(existingContent)
      if (typeof parsed === "object" && parsed !== null) meta = parsed
    } catch {
      // malformed existing profile — start fresh
    }
  }
  meta.picture = pictureUrl
  return {
    kind: 0,
    // eslint-disable-next-line camelcase
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(meta),
  }
}

/** NIP-96 async-upload marker: when present, the file processes server-side and the result
 *  lands at this URL (poll it). */
export const extractProcessingUrl = (responseJson: unknown): string | null => {
  try {
    const url = (responseJson as { data?: { processing_url?: unknown } })?.data
      ?.processing_url
    return typeof url === "string" && url.startsWith("https://") ? url : null
  } catch {
    return null
  }
}

/**
 * Extract the uploaded file URL from a NIP-96 upload response body (raw text). Tolerant:
 * nip94 `url` tag (spec shape) → `data.url` → top-level `url` → first https URL in the body
 * whose host matches the upload host or that ends in an image extension. Returns null on
 * total mismatch (callers log the raw body for shape discovery).
 */
export const extractUploadedUrl = (
  responseText: string,
  uploadHost: string,
): string | null => {
  let json: unknown = null
  try {
    json = JSON.parse(responseText)
  } catch {
    json = null
  }
  if (json) {
    const tags = (json as { data?: { nip94_event?: { tags?: unknown } } })?.data
      ?.nip94_event?.tags
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (Array.isArray(tag) && tag[0] === "url" && typeof tag[1] === "string") {
          const url = tag[1]
          if (url.startsWith("https://") || url.startsWith("http://")) return url
        }
      }
    }
    const dataUrl = (json as { data?: { url?: unknown } })?.data?.url
    if (typeof dataUrl === "string" && dataUrl.startsWith("http")) return dataUrl
    const topUrl = (json as { url?: unknown })?.url
    if (typeof topUrl === "string" && topUrl.startsWith("http")) return topUrl
  }
  // Fallback: any https URL on the upload host, or any image-looking URL.
  const urls = responseText.match(/https:\/\/[^\s"\\]+/g) ?? []
  const onHost = urls.find((u) => u.includes(uploadHost))
  if (onHost) return onHost
  return urls.find((u) => /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(u)) ?? null
}
