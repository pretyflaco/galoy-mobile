import { useCallback, useMemo, useState } from "react"

import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import * as nip19 from "nostr-tools/nip19"

import { getApprovalCoordinator } from "@app/nostr/approval/coordinator"
import { importIdentity, validateNsec, type ImportPorts } from "@app/nostr/core/identity"
import { NOSTR_NSEC_SERVICE, writeSecret } from "@app/nostr/core/keystore"
import { getNpubPush } from "@app/nostr/core/npub-push-runtime"

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

  const ports = useMemo<ImportPorts>(
    () => ({
      persistNsec: (privKeyHex) => writeSecret(NOSTR_NSEC_SERVICE, privKeyHex),
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
    [],
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
    } finally {
      setBusy(false)
      setCandidate(null)
    }
  }, [candidate, ports])

  const cancel = useCallback(() => {
    setCandidate(null)
    setPhase("input")
  }, [])

  return { phase, busy, submit, confirmReplace, cancel }
}
