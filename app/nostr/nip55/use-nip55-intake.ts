/**
 * The NIP-55 intake hook — the adapter-layer glue between the native holder activity and
 * the runtime handler (mirrors the nostrconnect:// deep-link intake pattern).
 *
 * Mounted once from NostrRuntimeProvider. Consumes a pending request on mount and on every
 * foreground transition (the holder activity forwards to MainActivity, so a request ALWAYS
 * coincides with the app coming active — cold start or warm). Pre-gates the flag + account
 * readiness at THIS adapter layer (AD-13: core stays flag-agnostic) and fails fast with a
 * rejection so the calling app is never left waiting on the timeouts.
 */
import { useCallback, useEffect } from "react"
import { AppState } from "react-native"

import type { SignerRuntime } from "../runtime"
import { rejectionForType } from "./parse"
import { Nip55Native } from "./native"
import type { Nip55PendingRequest } from "./types"

export const useNip55Intake = (
  runtime: SignerRuntime,
  enabled: boolean,
  accountReady: boolean,
): void => {
  const drain = useCallback(async () => {
    try {
      const rawJson = await Nip55Native.consumePending()
      if (!rawJson) return
      const raw = JSON.parse(rawJson) as Nip55PendingRequest
      if (!enabled || !accountReady) {
        // Fail fast: the signer is invisible or the identity scope is unresolved — the
        // caller gets its rejection immediately instead of outliving the 120s timeout.
        Nip55Native.complete(JSON.stringify(rejectionForType(raw)))
        return
      }
      await runtime.handleNip55(raw)
    } catch {
      // An intake failure must never throw into the host app (NFR-9); the native watchdog
      // finishes the holder activity with RESULT_CANCELED if no answer ever arrives.
    }
  }, [runtime, enabled, accountReady])

  useEffect(() => {
    drain().catch(() => undefined)
  }, [drain])

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") drain().catch(() => undefined)
    })
    return () => sub.remove()
  }, [drain])
}
