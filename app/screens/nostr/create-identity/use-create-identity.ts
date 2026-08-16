import { useCallback, useMemo, useRef, useState } from "react"

import * as nip19 from "nostr-tools/nip19"

import {
  logNostrIdentityCeremonyCompleted,
  logNostrIdentityCeremonyStarted,
} from "@app/nostr/analytics"
import { generateNostrKey } from "@app/nostr/core/keygen"
import { createNpubOutbox } from "@app/nostr/core/outbox"
import {
  confirmCreate,
  initialCeremonyState,
  retryAfterError,
  toConfirm,
  type CeremonyPorts,
  type CeremonyState,
} from "@app/nostr/core/identity"
import { NOSTR_NSEC_SERVICE, writeSecret } from "@app/nostr/core/keystore"

/**
 * React binding for the creation-ceremony controller (Story 1.5). The screens call
 * `start`/`confirm`/`retry`; all business logic (fail-closed keygen, AD-9 exclusive
 * commit, non-blocking AD-12 npub push) lives in app/nostr/core/identity.ts.
 */
export const useCreateIdentity = () => {
  const [state, setState] = useState<CeremonyState>(initialCeremonyState)
  const [busy, setBusy] = useState(false)
  const outbox = useMemo(() => createNpubOutbox(), [])
  const epochRef = useRef(0)

  const ports = useMemo<CeremonyPorts>(
    () => ({
      generateKey: generateNostrKey,
      persistNsec: (privKeyHex) => writeSecret(NOSTR_NSEC_SERVICE, privKeyHex),
      toNpub: (pubKeyHex) => nip19.npubEncode(pubKeyHex),
      // AD-9 exclusive section: minimal in-hook guard until the ApprovalCoordinator
      // pause seam lands (Epic 3); commit runs atomically here.
      runExclusive: async (commit) => commit(),
      commitIdentity: async () => {
        epochRef.current += 1
        return epochRef.current
      },
      pushNpub: async (npub) => {
        outbox.enqueue(npub)
      },
    }),
    [outbox],
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
      if (next.step === "result") logNostrIdentityCeremonyCompleted()
    } finally {
      setBusy(false)
    }
  }, [state, ports])

  const retry = useCallback(() => setState((s) => retryAfterError(s)), [])

  return { state, busy, start, confirm, retry }
}
