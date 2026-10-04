/**
 * Screenshots in the support chat (M19) — Marmot encrypted-media v1:
 *   the image is encrypted on the phone with a key derived from the conversation's MLS
 *   exporter secret (marmot-ts `group.encryptMedia`), only the CIPHERTEXT is uploaded to
 *   Blink's Blossom server, and the message carries an `imeta` tag (hashes, nonce, type,
 *   locator). Blossom never sees the image; the relay (a group member) decrypts it and
 *   shows it to the support team in the encrypted Matrix room.
 * Upload auth: a BUD-11 kind-24242 event signed by the device's support key.
 */
/**
 * M20 (finding 3): pictures at rest are ENCRYPTED. The canonical copy lives AES-GCM
 * sealed (the per-scope store key, encrypted-store.ts) under
 * `Caches/support-media/<name>.enc` — Caches, not Documents: no iCloud backup on iOS,
 * and a purge only costs a re-decrypt/re-download. For display a short-lived PLAINTEXT
 * shadow is written to `Caches/support-media-live/<name>` and wiped on background /
 * client destroy. "Save to Photos"/"Share" stay explicit user exports of the shadow.
 * iOS gives the app container a new UUID on every update/reinstall, so only file NAMES
 * are ever stored — every path is resolved against today's directories (mediaUri).
 */
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import Config from "react-native-config"
import RNFS from "react-native-fs"

import { openBytes, sealBytes } from "./encrypted-store"
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

/** Images we display: JPEG / PNG / WebP by magic bytes (never the sender's claim). */
export const imageExt = (b: Uint8Array): "jpg" | "png" | "webp" | null => {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg"
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "png"
  if (
    b.length > 12 &&
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  )
    return "webp"
  return null
}

/** Only https blob URLs on Blink's Blossom, path = /<sha256>[.ext]. */
export const allowedBlobUrl = (value: string, server: string = BLOSSOM_URL): boolean => {
  try {
    const u = new URL(value)
    const s = new URL(server)
    return (
      u.protocol === "https:" &&
      u.host === s.host &&
      /^\/[0-9a-f]{64}(\.[a-z0-9]+)?$/.test(u.pathname) &&
      !u.search
    )
  } catch {
    return false
  }
}

/** Blobs larger than this are not downloaded (Blossom's own cap is 8 MB). */
export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024

/** The CURRENT file URI of a stored chat picture's decrypted shadow (see the header).
 *  iOS gives the app container a new UUID on every update/reinstall, so an absolute path
 *  stored in the history goes stale: resolve by file name against today's live dir
 *  (also repairs items stored before this fix). */
export const mediaUri = (storedPath: string): string =>
  `file://${RNFS.CachesDirectoryPath}/support-media-live/${storedPath.split("/").pop()}`

const SEALED_DIR = () => `${RNFS.CachesDirectoryPath}/support-media`
const LIVE_DIR = () => `${RNFS.CachesDirectoryPath}/support-media-live`
const LEGACY_DIR = () => `${RNFS.DocumentDirectoryPath}/support-media`

const mediaAad = (scope: string, name: string) => `supportchat.media.${scope}.${name}`

/** Write the ENCRYPTED canonical copy; returns the file name (`<sha256>.<ext>`). */
export const storeSealedImage = async (
  scope: string,
  name: string,
  data: Uint8Array,
): Promise<void> => {
  await RNFS.mkdir(SEALED_DIR()).catch(() => undefined)
  const sealed = await sealBytes(scope, mediaAad(scope, name), data)
  await RNFS.writeFile(
    `${SEALED_DIR()}/${name}.enc`,
    Buffer.from(sealed).toString("base64"),
    "base64",
  )
}

/** The plaintext shadow for display: decrypt the sealed copy if the shadow is gone. */
export const ensureLiveImage = async (scope: string, name: string): Promise<void> => {
  const live = `${LIVE_DIR()}/${name}`
  if (await RNFS.exists(live)) return
  const sealedPath = `${SEALED_DIR()}/${name}.enc`
  if (!(await RNFS.exists(sealedPath))) return // the "not available any more" fallback
  const sealed = new Uint8Array(
    Buffer.from(await RNFS.readFile(sealedPath, "base64"), "base64"),
  )
  const data = await openBytes(scope, mediaAad(scope, name), sealed)
  await RNFS.mkdir(LIVE_DIR()).catch(() => undefined)
  await RNFS.writeFile(live, Buffer.from(data).toString("base64"), "base64")
}

/** Decrypt the shadows of every picture in a loaded item list (display invariant). */
export const ensureLiveImages = async (
  scope: string,
  items: { image?: { path: string } }[],
): Promise<void> => {
  for (const i of items) {
    if (i.image?.path) {
      const name = i.image.path.split("/").pop() as string
      await ensureLiveImage(scope, name).catch(() => undefined)
    }
  }
}

/** Wipe every plaintext shadow (app background / client destroy). */
export const wipeLiveImages = async (): Promise<void> => {
  await RNFS.unlink(LIVE_DIR()).catch(() => undefined)
}

/**
 * One-time migration (M20): plaintext pictures written by earlier versions under
 * Documents/support-media are sealed into Caches and the plaintext is deleted.
 */
export const migratePlaintextMedia = async (scope: string): Promise<number> => {
  const dir = LEGACY_DIR()
  if (!(await RNFS.exists(dir))) return 0
  const files = await RNFS.readDir(dir).catch(() => [])
  let moved = 0
  for (const f of files.filter((x) => x.isFile() && !x.name.endsWith(".enc"))) {
    try {
      const data = new Uint8Array(
        Buffer.from(await RNFS.readFile(f.path, "base64"), "base64"),
      )
      await storeSealedImage(scope, f.name, data)
      await RNFS.unlink(f.path)
      moved += 1
    } catch {
      // a file that fails to seal stays put; the next start retries
    }
  }
  await RNFS.unlink(dir).catch(() => undefined) // only succeeds when empty
  return moved
}
