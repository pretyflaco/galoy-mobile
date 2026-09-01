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
import { AppState } from "react-native"

import { useApolloClient } from "@apollo/client"

import { useFeatureFlags } from "@app/config/feature-flags-context"
import { GetUsernamesDocument } from "@app/graphql/generated"
import { useAppConfig } from "@app/hooks"

import { setNostrConnectHandler } from "./connect-link-handler"
import { nostrNsecService } from "./core/account-scope"
import { NOSTR_TRANSPORT_SERVICE, readSecret } from "./core/keystore"
import { setNpubPushScopeResolver } from "./core/npub-push-runtime"
import { createSignerRuntime, type SignerRuntime } from "./runtime"
import { provisionTransportKey } from "./transport/transport-key"
import { initSignerGate } from "./signer-gate"
import { useNostrAccountKey } from "./use-nostr-account-key"
import type { ApprovalCoordinator } from "./approval/coordinator"

export interface NostrRuntimeContextValue {
  runtime: SignerRuntime
  coordinator: ApprovalCoordinator
  /** Whether the signer is currently enabled by the remote flag (AD-13). */
  enabled: boolean
  /**
   * THE single shared account-scope resolution (2026-08-20): every consumer (identity hub,
   * create/import ceremonies, BTCPay setup) MUST read the scope from here — never instantiate
   * `useNostrAccountKey` independently. Independent instances resolve the session profile at
   * different times and can disagree (observed: ceremony wrote to the correct slot while the
   * provider still held a stale null → signing failed → loop back to the hub).
   */
  accountKey: string | null
  /** False while the scope is unresolved/healing — identity creation stays gated. */
  accountReady: boolean
}

const NostrRuntimeContext = createContext<NostrRuntimeContextValue | null>(null)

/**
 * Read the device-local transport secret as hex (AD-4), provisioning it on first use.
 *
 * The transport keypair is distinct from the identity (it drives kind-24133 NIP-46 transport
 * encryption, not signing). It must exist before the connect handshake can ack; nothing else
 * wired `provisionTransportKey`, so the read self-provisions here (idempotent — an existing key
 * is never overwritten). Without this the connect-ack path threw "transport key unavailable"
 * before publishing, so the BTCPay plugin never received the ack and the browser spun forever.
 */
const readTransportSkHex = async (): Promise<string> => {
  const hex = await readSecret(NOSTR_TRANSPORT_SERVICE)
  if (hex) return hex
  await provisionTransportKey() // generates + persists on first call (AD-6 CSPRNG)
  const provisioned = await readSecret(NOSTR_TRANSPORT_SERVICE)
  if (!provisioned) throw new Error("nostr transport key unavailable")
  return provisioned
}

export const NostrRuntimeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const featureFlags = useFeatureFlags()
  const enabled = featureFlags.nostrSignerEnabled
  const apolloClient = useApolloClient()
  const { accountKey, ready: accountScopeReady } = useNostrAccountKey()
  const accountReady = accountScopeReady && accountKey !== null
  const {
    appConfig: {
      galoyInstance: { lnAddressHostname },
    },
  } = useAppConfig()

  // The runtime is constructed ONCE, so the account scope reaches it through a ref —
  // consulted per access (readNsecHex + storage keys), current after every account switch.
  const accountKeyRef = useRef<string | null>(null)
  accountKeyRef.current = accountKey
  setNpubPushScopeResolver(() => accountKeyRef.current)

  // Construct the runtime exactly once for the app's lifetime (AD-11 single-owner substrate).
  const runtimeRef = useRef<SignerRuntime | null>(null)
  if (runtimeRef.current === null) {
    runtimeRef.current = createSignerRuntime({
      // Account-scoped identity (2026-08-20): the nsec lives under `nostr.nsec.<accountKey>`.
      // Null scope (account unresolvable) ⇒ unavailable — fail-closed, never a shared slot.
      readNsecHex: async () => {
        const key = accountKeyRef.current
        if (!key) throw new Error("nostr identity key unavailable")
        const hex = await readSecret(nostrNsecService(key))
        if (!hex) throw new Error("nostr identity key unavailable")
        return hex
      },
      readTransportSkHex,
      accountScopeKey: () => accountKeyRef.current,
      // One-click BTCPay setup: the signed-in account's lightning address is username@host
      // (custodial accounts only; device accounts have no username → no tag → no provisioning).
      // cache-first: the profile query runs at sign-in, so later reads are cache hits and add
      // no latency to the login sign path.
      readLightningAddress: async () => {
        const { data } = await apolloClient.query({
          query: GetUsernamesDocument,
          fetchPolicy: "cache-first",
        })
        const username = data?.me?.username
        return username ? `${username}@${lnAddressHostname}` : undefined
      },
    })
  }
  const runtime = runtimeRef.current

  // Account switched: re-read the new account's scoped connections + resubscribe its relays.
  useEffect(() => {
    runtime.reloadAccountScope().catch(() => undefined)
  }, [runtime, accountKey])

  // Apply the flag on every change (initSignerGate is idempotent per init). Flag toggles never
  // clear connection records — the gate deps expose no clear() (retention, AD-13). Register the
  // nostrconnect:// deep-link/QR handler ONLY while enabled; clear it when off so a
  // nostrconnect:// URL is not consumed (signer invisible + inert, NFR-9).
  useEffect(() => {
    initSignerGate(enabled, runtime.gateDeps)
    setNostrConnectHandler(enabled ? (uri) => runtime.handleConnectUri(uri) : null)
    return () => setNostrConnectHandler(null)
  }, [enabled, runtime])

  // Foreground recovery (same-device NIP-46): relay sockets can be throttled/dropped while the
  // app is backgrounded, and a NIP-46 sign-in challenge is ephemeral — if our #p subscriber is
  // gone when the client publishes it, the request is lost and the awaiting overlay spins
  // forever. Re-warm + re-subscribe on every foreground transition so the challenge always has a
  // live listener. Runtime-side the call no-ops when there are no connected relays.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") runtime.handleForeground()
    })
    return () => sub.remove()
  }, [runtime])

  const value = useMemo<NostrRuntimeContextValue>(
    () => ({
      runtime,
      coordinator: runtime.coordinator,
      enabled,
      accountKey,
      accountReady,
    }),
    [runtime, enabled, accountKey, accountReady],
  )

  return (
    <NostrRuntimeContext.Provider value={value}>{children}</NostrRuntimeContext.Provider>
  )
}

/** Access the signer runtime + coordinator. Returns null when the provider is absent. */
export const useNostrRuntime = (): NostrRuntimeContextValue | null =>
  useContext(NostrRuntimeContext)
