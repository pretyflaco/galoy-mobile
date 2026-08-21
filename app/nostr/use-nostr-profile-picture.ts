/**
 * Shared read of the ACTIVE account's identity profile picture (kind-0 `picture`, fetched via
 * the runtime's relay path with its 5-min cache). Extracted from the hub wrapper's inline
 * effect so the settings banner can show the same avatar. `setPictureUrl` lets an uploader
 * apply a fresh value immediately (the runtime cache would otherwise lag the publish).
 */
import { useEffect, useState } from "react"

import { useNostrRuntime } from "./nostr-runtime-provider"

export const useNostrProfilePicture = (
  pubkeyHex: string | null,
  /** Change this value to force a re-read (e.g. screen focus) without waiting for mount. */
  refetchSignal?: unknown,
): [string | null, (url: string | null) => void] => {
  const nostr = useNostrRuntime()
  const [pictureUrl, setPictureUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!pubkeyHex) {
      setPictureUrl(null)
      return
    }
    let cancelled = false
    nostr?.runtime
      .fetchOwnProfilePicture()
      .then((url) => {
        if (!cancelled) setPictureUrl(url)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [nostr, pubkeyHex, refetchSignal])

  return [pictureUrl, setPictureUrl]
}
