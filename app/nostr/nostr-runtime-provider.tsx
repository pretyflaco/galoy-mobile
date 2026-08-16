/**
 * NostrRuntimeProvider (Story A2 / AD-1 / AD-13) — the RN mounting layer for the signer runtime.
 *
 * This is the single React boundary that:
 *  - constructs the ONE process-wide signer runtime (app/nostr/runtime.ts), binding its native
 *    ports (identity nsec + device-local transport secret reads from the keystore; the approval
 *    surface presenter);
 *  - applies the AD-13 feature flag on every remote-config read via initSignerGate — flag OFF ⇒
 *    entry points deactivated + relays closed + records RETAINED; flag ON ⇒ entry points active
 *    and retained connections resumed;
 *  - exposes the runtime + the single ApprovalCoordinator through context so the approval surface
 *    (useApprovalCoordinator) and the nostrconnect:// entry point (A3) consume the SAME instances.
 *
 * The runtime itself carries no React/UI (AD-1); this provider is the only place the two meet.
 * The provider never touches wallet flows — flag OFF leaves the host wallet fully untouched
 * (NFR-9).
 */
import React, { createContext, useContext, useEffect, useMemo, useRef } from "react"

import { useFeatureFlags } from "@app/config/feature-flags-context"

import { setNostrConnectHandler } from "./connect-link-handler"
import { NOSTR_NSEC_SERVICE, NOSTR_TRANSPORT_SERVICE, readSecret } from "./core/keystore"
import { createSignerRuntime, type SignerRuntime } from "./runtime"
import { initSignerGate } from "./signer-gate"
import type { ApprovalCoordinator } from "./approval/coordinator"

export interface NostrRuntimeContextValue {
  runtime: SignerRuntime
  coordinator: ApprovalCoordinator
  /** Whether the signer is currently enabled by the remote flag (AD-13). */
  enabled: boolean
}

const NostrRuntimeContext = createContext<NostrRuntimeContextValue | null>(null)

/**
 * Read the identity nsec as lowercase hex from the keystore (the sole NostrSigner-seam input).
 * Throws if absent so the seam surfaces `unavailable` rather than signing with a missing key.
 */
const readNsecHex = async (): Promise<string> => {
  const hex = await readSecret(NOSTR_NSEC_SERVICE)
  if (!hex) throw new Error("nostr identity key unavailable")
  return hex
}

/** Read the device-local transport secret as hex (AD-4); provisioned on first signer enable. */
const readTransportSkHex = async (): Promise<string> => {
  const hex = await readSecret(NOSTR_TRANSPORT_SERVICE)
  if (!hex) throw new Error("nostr transport key unavailable")
  return hex
}

export const NostrRuntimeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const featureFlags = useFeatureFlags()
  const enabled = featureFlags.nostrSignerEnabled

  // Construct the runtime exactly once for the app's lifetime (AD-11 single-owner substrate).
  const runtimeRef = useRef<SignerRuntime | null>(null)
  if (runtimeRef.current === null) {
    runtimeRef.current = createSignerRuntime({
      readNsecHex,
      readTransportSkHex,
    })
  }
  const runtime = runtimeRef.current

  // Apply the flag on every change (initSignerGate is idempotent per init). Flag toggles never
  // clear connection records — the gate deps expose no clear() (retention, AD-13). Register the
  // nostrconnect:// deep-link/QR handler ONLY while enabled; clear it when off so a
  // nostrconnect:// URL is not consumed (signer invisible + inert, NFR-9).
  useEffect(() => {
    initSignerGate(enabled, runtime.gateDeps)
    setNostrConnectHandler(enabled ? (uri) => runtime.handleConnectUri(uri) : null)
    return () => setNostrConnectHandler(null)
  }, [enabled, runtime])

  const value = useMemo<NostrRuntimeContextValue>(
    () => ({ runtime, coordinator: runtime.coordinator, enabled }),
    [runtime, enabled],
  )

  return (
    <NostrRuntimeContext.Provider value={value}>{children}</NostrRuntimeContext.Provider>
  )
}

/** Access the signer runtime + coordinator. Returns null when the provider is absent. */
export const useNostrRuntime = (): NostrRuntimeContextValue | null =>
  useContext(NostrRuntimeContext)
