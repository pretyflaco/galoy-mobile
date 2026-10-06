import { useCallback, useMemo, useRef, useState } from "react"

import * as nip19 from "nostr-tools/nip19"

import {
  logNostrIdentityCeremonyCompleted,
  logNostrIdentityCeremonyStarted,
} from "@app/nostr/analytics"
import { getApprovalCoordinator } from "@app/nostr/approval/coordinator"
import { nostrBackupDoneKey, nostrNsecService } from "@app/nostr/core/account-scope"
import { generateNostrKey } from "@app/nostr/core/keygen"
import { getNpubPush } from "@app/nostr/core/npub-push-runtime"
import { confirmCreate, type CeremonyPorts } from "@app/nostr/core/identity"
import { writeSecret } from "@app/nostr/core/keystore"
import { makeSignerError, type SignerError } from "@app/nostr/core/signer"
import { useNostrRuntime } from "@app/nostr/nostr-runtime-provider"
import { useNostrAccountMode } from "@app/nostr/use-nostr-account-key"
import { deriveNsecFromMnemonic } from "@app/self-custodial/derive-nostr-key"
import { BackupStatus, useBackupState } from "@app/self-custodial/providers/backup-state"
import KeyStoreWrapper from "@app/utils/storage/secureStorage"
import { saveString } from "@app/utils/storage/storage"

/** Where the ceremony's new nsec comes from (self-custodial accounts may bind it to the wallet seed). */
export type IdentityKeySource = "seed" | "random"

export type CreatePhase = "choose" | "generating" | "error" | "done"

/** Deliberate minimum on-screen time for the Generating step — key generation is instant,
 *  but the transition should read as a real step, not a flicker. */
const GENERATING_MIN_MS = 1500

/**
 * React binding for the creation flow (redesign r3, spec §6.2–6.4): there is NO confirm
 * step and NO result/ownership screen — choosing a source runs generation immediately
 * behind the Generating screen, and success lands back on the Hub.
 *
 * The key-source choice is presented ONLY when a wallet phrase is available
 * (`isSelfCustodial` AND the wallet seed backup is completed); every other account goes
 * straight to Generating with a fresh random key (spec §7.3 — "never shown" otherwise).
 *
 * Seed-derived keys are covered by the wallet backup, so a successful seed creation
 * writes the per-account backup marker (`wallet-seed`) — no Hub banner / Home alert.
 */
export const useCreateIdentity = () => {
  const [phase, setPhase] = useState<CreatePhase>("choose")
  const [error, setError] = useState<SignerError | null>(null)
  const epochRef = useRef(0)
  // Chosen at `create(source)` — the keygen port reads it through the closure.
  const sourceRef = useRef<IdentityKeySource>("random")
  // Shared scope from the provider context — never an independent resolver instance.
  const runtimeContext = useNostrRuntime()
  const accountKey = runtimeContext?.accountKey ?? null
  const { isSelfCustodial, accountKey: selfCustodialAccountId } = useNostrAccountMode()
  const { backupState } = useBackupState()

  // Spec §8: the choice screen is gated on `canDeriveFromSeed: isSelfCustodial` AND the
  // wallet seed already being backed up. No BackupRequiredModal — the option simply
  // doesn't exist when the phrase isn't available.
  const canChooseSource = isSelfCustodial && backupState.status === BackupStatus.Completed

  const ports = useMemo<CeremonyPorts>(
    () => ({
      // "Generate from wallet": NIP-06 derivation m/44'/1237'/0'/0/0 from the account's
      // Spark mnemonic. The "random" path keeps the fail-closed CSPRNG keygen. Both land
      // in the same keystore path; only provenance differs.
      generateKey: async () => {
        if (!(isSelfCustodial && sourceRef.current === "seed")) return generateNostrKey()
        if (!selfCustodialAccountId)
          throw makeSignerError("unavailable", "account is still being set up")
        const mnemonic =
          await KeyStoreWrapper.getMnemonicForAccount(selfCustodialAccountId)
        if (!mnemonic)
          throw makeSignerError(
            "unavailable",
            "wallet seed unavailable for this account — restore the wallet first",
          )
        return deriveNsecFromMnemonic(mnemonic)
      },
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
    [accountKey, isSelfCustodial, selfCustodialAccountId],
  )

  const create = useCallback(
    async (source: IdentityKeySource) => {
      logNostrIdentityCeremonyStarted()
      sourceRef.current = source
      setError(null)
      setPhase("generating")
      const hold = new Promise((resolve) => {
        setTimeout(resolve, GENERATING_MIN_MS)
      })
      try {
        const [next] = await Promise.all([
          confirmCreate({ step: "confirm", identity: null, error: null }, ports),
          hold,
        ])
        if (next.step === "result") {
          logNostrIdentityCeremonyCompleted()
          // Wallet-derived keys are auto-backed-up (spec §8): covered by the wallet phrase.
          if (source === "seed" && accountKey) {
            saveString(nostrBackupDoneKey(accountKey), "wallet-seed").catch(
              () => undefined,
            )
          }
          // H3 fix (audit): a fresh identity invalidates every existing connection — grants
          // issued against the PRIOR key must never be served by the new one. Best-effort:
          // the identity is already committed; voiding is consent hygiene, not durability.
          runtimeContext?.runtime.voidAllConnections().catch(() => undefined)
          setPhase("done")
          return
        }
        setError(next.error)
        setPhase("error")
      } catch (cause) {
        // Fail closed (e.g. account scope unresolvable or a keystore write failure) —
        // never an unhandled rejection, never a partial identity.
        setError(makeSignerError("unavailable", "identity commit failed", cause))
        setPhase("error")
      }
    },
    [ports, accountKey, runtimeContext],
  )

  const retry = useCallback(() => create(sourceRef.current), [create])

  return { phase, error, create, retry, canChooseSource, source: sourceRef.current }
}
