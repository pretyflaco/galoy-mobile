/**
 * Profile photo upload flow for the identity hub (2026-08-21): pick an image, upload it to the
 * NIP-96 media host (auth = locally-signed NIP-98 event with the file's sha256 `payload` tag —
 * the user's tap is the consent, no approval surface), then publish the identity's kind-0 with
 * the new `picture` URL (merged into the existing profile content so other fields are never
 * clobbered).
 *
 * Result distinguishes user-cancel from failure (callers toast only on failure). Each stage
 * logs a console.warn marker ([nostr-avatar] …) so a failing stage is identifiable in logcat.
 */
import { useState } from "react"

import { sha256 } from "@noble/hashes/sha256.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { launchImageLibrary } from "react-native-image-picker"
import RNFS from "react-native-fs"

import {
  buildProfileMetadataTemplate,
  buildUploadAuthTemplate,
  extractProcessingUrl,
  extractUploadedUrl,
  NIP96_UPLOAD_URL,
  PROFILE_PUBLISH_RELAYS,
} from "@app/nostr/core/profile-publish"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"

export type ProfileUploadResult =
  | { ok: true; url: string }
  | { ok: false; cancelled: boolean }

const log = (stage: string, detail: string): void => {
  console.warn(`[nostr-avatar] ${stage}: ${detail}`)
}

export const useProfilePictureUpload = (): {
  uploading: boolean
  pickUploadPublish: () => Promise<ProfileUploadResult>
} => {
  const nostr = useNostrRuntime()
  const [uploading, setUploading] = useState(false)

  const pickUploadPublish = async (): Promise<ProfileUploadResult> => {
    if (!nostr) return { ok: false, cancelled: false }
    setUploading(true)
    try {
      const pick = await launchImageLibrary({
        mediaType: "photo",
        quality: 0.8,
        maxWidth: 1024,
        maxHeight: 1024,
      })
      if (pick.didCancel) return { ok: false, cancelled: true }
      if (pick.errorCode) {
        log("pick", `${pick.errorCode} ${pick.errorMessage ?? ""}`)
        return { ok: false, cancelled: false }
      }
      const asset = pick.assets?.[0]
      if (!asset?.uri) {
        log("pick", "no asset uri")
        return { ok: false, cancelled: false }
      }

      // File bytes (for the NIP-96 `payload` hash + size sanity), base64 via RNFS.
      let payloadHash: string
      try {
        const base64 = await RNFS.readFile(asset.uri, "base64")
        payloadHash = bytesToHex(sha256(Buffer.from(base64, "base64")))
      } catch (err) {
        log("read-file", String(err))
        return { ok: false, cancelled: false }
      }

      // NIP-98 auth event for the NIP-96 upload endpoint (URL + POST + payload hash).
      const authEvent = await nostr.runtime.signAuthEvent(
        buildUploadAuthTemplate(NIP96_UPLOAD_URL, payloadHash),
      )
      const auth = Buffer.from(JSON.stringify(authEvent), "utf-8").toString("base64")

      const form = new FormData()
      form.append("file", {
        uri: asset.uri,
        name: asset.fileName ?? "avatar.jpg",
        type: asset.type ?? "image/jpeg",
      } as unknown as Blob)
      const resp = await fetch(NIP96_UPLOAD_URL, {
        method: "POST",
        headers: { Authorization: `Nostr ${auth}` },
        body: form,
      })
      if (!resp.ok) {
        log("upload", `HTTP ${resp.status}`)
        return { ok: false, cancelled: false }
      }
      const uploadHost = new URL(NIP96_UPLOAD_URL).host
      let body = await resp.text()
      let url = extractUploadedUrl(body, uploadHost)

      // NIP-96 async variant: the server hands back a processing_url; poll it briefly.
      if (!url) {
        let parsedBody: unknown = null
        try {
          parsedBody = JSON.parse(body)
        } catch {
          parsedBody = null
        }
        const processingUrl = extractProcessingUrl(parsedBody)
        if (processingUrl) {
          for (let attempt = 0; attempt < 3 && !url; attempt += 1) {
            await new Promise((resolve) => {
              setTimeout(resolve, 2000)
            })
            const poll = await fetch(processingUrl)
            if (poll.ok) {
              body = await poll.text()
              url = extractUploadedUrl(body, uploadHost)
            }
          }
        }
      }
      if (!url) {
        // Shape discovery: the raw body names the actual response format in logcat.
        log("parse", `no url in response: ${body.slice(0, 800)}`)
        return { ok: false, cancelled: false }
      }

      const existing = await nostr.runtime.fetchOwnProfileMetadata()
      const published = await nostr.runtime.signAndPublish(
        buildProfileMetadataTemplate(url, existing),
        [...PROFILE_PUBLISH_RELAYS],
      )
      if (!published) {
        log("publish", "no relay ACK")
        return { ok: false, cancelled: false }
      }
      log("done", url)
      return { ok: true, url }
    } catch (err) {
      log("exception", String(err))
      return { ok: false, cancelled: false }
    } finally {
      setUploading(false)
    }
  }

  return { uploading, pickUploadPublish }
}
