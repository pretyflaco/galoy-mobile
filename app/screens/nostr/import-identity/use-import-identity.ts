import { useCallback, useMemo, useState } from "react"

import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

import { getApprovalCoordinator } from "@app/nostr/approval/coordinator"
import { nostrNsecService } from "@app/nostr/core/account-scope"
import { importIdentity, validateNsec, type ImportPorts } from "@app/nostr/core/identity"
import { writeSecret } from "@app/nostr/core/keystore"
import { getNpubPush } from "@app/nostr/core/npub-push-runtime"
import { makeSignerError } from "@app/nostr/core/signer"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"

type Phase = "input" | "confirm" | "invalid" | "done"

const deriveNpub = (privKeyHex: string): string =>
  nip19.npubEncode(bytesToHex(schnorr.getPublicKey(hexToBytes(privKeyHex))))

/**
 * React binding for the nsec import/replace flow (Story 1.6). Validation and the
 * replace commit (AD-9 exclusive section, AD-12 monotonic push) live in
 * app/nostr/core/identity.ts; this hook holds screen phase + the validated candidate.
 */
export const useImportIdentity = () => {
  const [phase, setPhase] = useState<Phase>("input")
  const [candidate, setCandidate] = useState<{ privKeyHex: string; npub: string } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  // Shared scope from the provider context — never an independent resolver instance.
  const runtimeContext = useNostrRuntime()
  const accountKey = runtimeContext?.accountKey ?? null

  const ports = useMemo<ImportPorts>(
    () => ({
      // Account-scoped (2026-08-20): persist under `nostr.nsec.<accountKey>`; fail closed
      // when the account scope is unresolvable (the hub normally gates entry first).
      persistNsec: async (privKeyHex) => {
        if (!accountKey)
          throw makeSignerError("unavailable", "account is still being set up")
        await writeSecret(nostrNsecService(accountKey), privKeyHex)
      },
      derivePubKeyHex: (privKeyHex) =>
        bytesToHex(schnorr.getPublicKey(hexToBytes(privKeyHex))),
      toNpub: (pubKeyHex) => nip19.npubEncode(pubKeyHex),
      // AD-9 exclusive section via the process-wide ApprovalCoordinator (Story 3.4):
      // presentation pauses + the pipeline holds queued while the replace commit runs.
      runExclusive: (commit) => getApprovalCoordinator().runExclusive(commit),
      commitIdentity: async () => Date.now(), // epoch source until the identity store lands (Epic 3)
      // AD-12/FR-9: enqueue the imported npub into the SAME shared persistent outbox as create
      // (single slot — a re-import supersedes the prior mapping) + fire a non-blocking drain.
      pushNpub: (npub) => getNpubPush().push(npub),
    }),
    [accountKey],
  )

  /** Validate a pasted/scanned value; advance to confirm or the invalid state. */
  const submit = useCallback((raw: string) => {
    const result = validateNsec(raw, deriveNpub)
    if (!result.ok) {
      setCandidate(null)
      setPhase("invalid")
      return
    }
    setCandidate({ privKeyHex: result.privKeyHex, npub: result.npub })
    setPhase("confirm")
  }, [])

  const confirmReplace = useCallback(async () => {
    if (!candidate) return
    setBusy(true)
    try {
      await importIdentity(candidate.privKeyHex, ports)
      setPhase("done")
      // H3 fix (audit): the replaced key invalidates every existing connection — grants
      // issued against the PRIOR identity must never be served by the imported one without
      // fresh consent. Best-effort: the import is already committed.
      runtimeContext?.runtime.voidAllConnections().catch(() => undefined)
    } catch {
      // Commit failed (e.g. account scope unresolvable or keystore write failure) —
      // back to the input step; nothing was persisted.
      setPhase("input")
    } finally {
      setBusy(false)
      setCandidate(null)
    }
  }, [candidate, ports, runtimeContext])

  const cancel = useCallback(() => {
    setCandidate(null)
    setPhase("input")
  }, [])

  return { phase, busy, submit, confirmReplace, cancel }
}
