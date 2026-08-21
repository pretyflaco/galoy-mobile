import { useCallback, useMemo, useRef, useState } from "react"

import * as nip19 from "nostr-tools/nip19"

import {
  logNostrIdentityCeremonyCompleted,
  logNostrIdentityCeremonyStarted,
} from "@app/nostr/analytics"
import { getApprovalCoordinator } from "@app/nostr/approval/coordinator"
import { nostrNsecService } from "@app/nostr/core/account-scope"
import { generateNostrKey } from "@app/nostr/core/keygen"
import { getNpubPush } from "@app/nostr/core/npub-push-runtime"
import {
  confirmCreate,
  initialCeremonyState,
  retryAfterError,
  toConfirm,
  type CeremonyPorts,
  type CeremonyState,
} from "@app/nostr/core/identity"
import { writeSecret } from "@app/nostr/core/keystore"
import { makeSignerError } from "@app/nostr/core/signer"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"

/**
 * React binding for the creation-ceremony controller (Story 1.5). The screens call
 * `start`/`confirm`/`retry`; all business logic (fail-closed keygen, AD-9 exclusive
 * commit, non-blocking AD-12 npub push) lives in app/nostr/core/identity.ts.
 */
export const useCreateIdentity = () => {
  const [state, setState] = useState<CeremonyState>(initialCeremonyState)
  const [busy, setBusy] = useState(false)
  const epochRef = useRef(0)
  // Shared scope from the provider context — never an independent resolver instance.
  const runtimeContext = useNostrRuntime()
  const accountKey = runtimeContext?.accountKey ?? null

  const ports = useMemo<CeremonyPorts>(
    () => ({
      generateKey: generateNostrKey,
      // Account-scoped (2026-08-20): persist under `nostr.nsec.<accountKey>`; fail closed
      // when the account scope is unresolvable (the hub normally gates entry first).
      persistNsec: async (privKeyHex) => {
        if (!accountKey)
          throw makeSignerError("unavailable", "account is still being set up")
        await writeSecret(nostrNsecService(accountKey), privKeyHex)
      },
      toNpub: (pubKeyHex) => nip19.npubEncode(pubKeyHex),
      // AD-9 exclusive section: route through the process-wide ApprovalCoordinator so the
      // coordinator PAUSES presentation and the pipeline HOLDS requests while the identity
      // mutation commits (Story 3.4). Falls back to a bare commit if unavailable.
      runExclusive: (commit) => getApprovalCoordinator().runExclusive(commit),
      commitIdentity: async () => {
        epochRef.current += 1
        return epochRef.current
      },
      // AD-12/FR-9: enqueue the new npub into the shared persistent outbox + fire a
      // non-blocking drain (Story 2.3). A slow/failing/absent endpoint never blocks the
      // ceremony — the push awaits only the durable enqueue.
      pushNpub: (npub) => getNpubPush().push(npub),
    }),
    [accountKey],
  )

  const start = useCallback(() => {
    logNostrIdentityCeremonyStarted()
    setState((s) => toConfirm(s))
  }, [])

  const confirm = useCallback(async () => {
    setBusy(true)
    try {
      const next = await confirmCreate({ ...state, step: "confirm" }, ports)
      setState(next)
      if (next.step === "result") {
        logNostrIdentityCeremonyCompleted()
        // H3 fix (audit): a fresh identity invalidates every existing connection — grants
        // issued against the PRIOR key must never be served by the new one. Best-effort:
        // the identity is already committed; voiding is consent hygiene, not durability.
        runtimeContext?.runtime.voidAllConnections().catch(() => undefined)
      }
    } catch (cause) {
      // Fail closed into the ceremony's error step (e.g. account scope unresolvable or a
      // keystore write failure) — never an unhandled rejection, never a partial identity.
      setState((s) => ({
        ...s,
        step: "error",
        error: makeSignerError("unavailable", "identity commit failed", cause),
      }))
    } finally {
      setBusy(false)
    }
  }, [state, ports, runtimeContext])

  const retry = useCallback(() => setState((s) => retryAfterError(s)), [])

  return { state, busy, start, confirm, retry }
}
