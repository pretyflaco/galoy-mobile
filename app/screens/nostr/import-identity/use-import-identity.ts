import { useCallback, useEffect, useMemo, useState } from "react"

import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

import { getApprovalCoordinator } from "@app/nostr/approval/coordinator"
import { nostrNsecService } from "@app/nostr/core/account-scope"
import { importIdentity, validateNsec, type ImportPorts } from "@app/nostr/core/identity"
import { readSecret, writeSecret } from "@app/nostr/core/keystore"
import { getNpubPush } from "@app/nostr/core/npub-push-runtime"
import { makeSignerError } from "@app/nostr/core/signer"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"

type Phase = "input" | "confirm" | "invalid" | "done"

const deriveNpub = (privKeyHex: string): string =>
  nip19.npubEncode(bytesToHex(schnorr.getPublicKey(hexToBytes(privKeyHex))))

/**
 * React binding for the nsec import/replace flow (Story 1.6 + redesign r3, spec §7.11).
 * Validation runs LIVE on every input change (the CTA stays disabled until a valid nsec);
 * the destructive replace confirm is shown only when an identity actually exists to
 * discard — a first import commits directly. Validation and the replace commit (AD-9
 * exclusive section, AD-12 monotonic push) live in app/nostr/core/identity.ts; this hook
 * holds screen phase + the validated candidate.
 */
export const useImportIdentity = () => {
  const [phase, setPhase] = useState<Phase>("input")
  const [candidate, setCandidate] = useState<{ privKeyHex: string; npub: string } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  // Null until probed — the confirm gate only applies to a REAL existing identity.
  const [identityExists, setIdentityExists] = useState<boolean | null>(null)
  // Shared scope from the provider context — never an independent resolver instance.
  const runtimeContext = useNostrRuntime()
  const accountKey = runtimeContext?.accountKey ?? null

  useEffect(() => {
    let mounted = true
    if (!accountKey) {
      setIdentityExists(false)
      return
    }
    readSecret(nostrNsecService(accountKey))
      .then((stored) => {
        if (mounted) setIdentityExists(Boolean(stored))
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [accountKey])

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

  /** Live validation for the input field (spec §7.11): pure, no phase change. */
  const validate = useCallback((raw: string): { valid: boolean; invalid: boolean } => {
    const trimmed = raw.trim()
    if (!trimmed) return { valid: false, invalid: false }
    return validateNsec(trimmed, deriveNpub).ok
      ? { valid: true, invalid: false }
      : { valid: false, invalid: true }
  }, [])

  const commit = useCallback(
    async (value: { privKeyHex: string; npub: string }) => {
      setBusy(true)
      try {
        await importIdentity(value.privKeyHex, ports)
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
    },
    [ports, runtimeContext],
  )

  /** Validate a pasted/scanned value; advance to confirm (existing identity) or commit. */
  const submit = useCallback(
    (raw: string) => {
      const result = validateNsec(raw, deriveNpub)
      if (!result.ok) {
        setCandidate(null)
        setPhase("invalid")
        return
      }
      if (identityExists) {
        setCandidate({ privKeyHex: result.privKeyHex, npub: result.npub })
        setPhase("confirm")
        return
      }
      // Nothing to discard — commit immediately (spec §7.11: Continue → Hub).
      commit({ privKeyHex: result.privKeyHex, npub: result.npub })
    },
    [identityExists, commit],
  )

  const confirmReplace = useCallback(async () => {
    if (!candidate) return
    await commit(candidate)
  }, [candidate, commit])

  const cancel = useCallback(() => {
    setCandidate(null)
    setPhase("input")
  }, [])

  return { phase, busy, validate, submit, confirmReplace, cancel }
}
