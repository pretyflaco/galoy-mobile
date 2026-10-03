/**
 * Screenshots in the support chat (M19) — Marmot encrypted-media v1:
 *   the image is encrypted on the phone with a key derived from the conversation's MLS
 *   exporter secret (marmot-ts `group.encryptMedia`), only the CIPHERTEXT is uploaded to
 *   Blink's Blossom server, and the message carries an `imeta` tag (hashes, nonce, type,
 *   locator). Blossom never sees the image; the relay (a group member) decrypts it and
 *   shows it to the support team in the encrypted Matrix room.
 * Upload auth: a BUD-11 kind-24242 event signed by the device's support key.
 */
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import Config from "react-native-config"

import type { BlinkEventSigner } from "./blink-signer"

const configured = Config?.SUPPORT_BLOSSOM_URL
export const BLOSSOM_URL =
  typeof configured === "string" && /^https?:\/\/[^\s/]+$/.test(configured)
    ? configured
    : "https://blossom.twentyone.ist"

/** The app sends images up to this size (Blossom refuses > 8 MB). */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024

const toBase64 = (s: string) => Buffer.from(s, "utf-8").toString("base64")

/** Upload already-ENCRYPTED bytes; returns the blob URL (`<server>/<sha256>`). */
export const uploadEncryptedBlob = async (
  signer: BlinkEventSigner,
  encrypted: Uint8Array,
  server: string = BLOSSOM_URL,
): Promise<string> => {
  const sha = bytesToHex(sha256(encrypted))
  const now = Math.floor(Date.now() / 1000)
  const auth = await signer.signEvent({
    kind: 24242,
    created_at: now, // eslint-disable-line camelcase
    content: "Upload blob",
    tags: [
      ["t", "upload"],
      ["x", sha],
      ["expiration", String(now + 300)],
    ],
  })
  const res = await fetch(`${server}/upload`, {
    method: "PUT",
    headers: {
      "Authorization": `Nostr ${toBase64(JSON.stringify(auth))}`,
      "Content-Type": "application/octet-stream",
      "X-SHA-256": sha,
    },
    body: encrypted,
  })
  if (!res.ok) {
    const reason = res.headers.get("x-reason") ?? (await res.text().catch(() => ""))
    throw new Error(
      `upload failed (HTTP ${res.status}${reason ? `: ${reason.slice(0, 80)}` : ""})`,
    )
  }
  // the server's descriptor may carry an http:// URL behind the TLS proxy: build our own
  return `${server}/${sha}`
}

/** A Blob-like for marmot-ts encryptMedia (it reads only `type` + `arrayBuffer()`; RN's
 *  Blob has no reliable arrayBuffer()). */
export const blobLike = (bytes: Uint8Array, type: string): Blob =>
  ({
    type,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }) as unknown as Blob
