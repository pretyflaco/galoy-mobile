/**
 * The NIP-55 request handler (UI-free, ports-injected — testable without React Native).
 *
 * Reuse, not rebuild: the two NIP-55 request shapes map 1:1 onto the existing POC seams —
 *  - `get_public_key` (login consent) → a CONNECTION approval entry through the ONE
 *    ApprovalCoordinator (the hero copy — "wants to sign you in and sign events on your
 *    behalf" — is exactly this consent), answered with the identity pubkey hex. No grant
 *    is written: every NIP-55 request prompts (Amber's default posture, and vezir's flow
 *    is one login + one sign per session anyway).
 *  - `sign_event` → the SAME `createSignEventFlow` the NIP-46 pipeline uses: AD-16 pubkey
 *    mismatch rejection BEFORE approval, unconditional id recomputation, `lnaddress` tag on
 *    login kinds, and signing ONLY through the NostrSigner seam.
 *
 * The identity/scope re-check after approval mirrors runSignEvent (H3): a decision made
 * against identity N / account scope A never executes against a different one.
 */
import * as nip19 from "nostr-tools/nip19"

import type { ApprovalCoordinator } from "../approval/coordinator"
import { buildSignEventPreview, formatSignEventPanel } from "../approval/request-preview"
import { NIP98_KIND } from "../core/policy-check"
import type { NostrSigner } from "../core/signer"
import { normalizeHost } from "../core/url-origin"
import { createSignEventFlow } from "../transport/sign-event"
import {
  parseNip55Request,
  pseudoClientKey,
  rejectionForType,
  toHexPubkey,
} from "./parse"
import type { Nip55PendingRequest, Nip55Result } from "./types"

export interface Nip55HandlerPorts {
  /** The signing seam (LocalNsecSigner) — the SOLE signing path (AD-2). */
  signer: Pick<NostrSigner, "getPublicKey" | "signEvent">
  /** The ONE approval coordinator (AD-9) — every NIP-55 request raises its own surface. */
  coordinator: ApprovalCoordinator
  /** Injected clock (seconds) for created_at defaulting. */
  now: () => number
  /** The ACTIVE account scope; an approval must not outlive an account switch (H3). */
  accountScopeKey?: () => string | null
  /** The signed-in account's lightning address (login-kind `lnaddress` tag; see sign-event). */
  readLightningAddress?: () => Promise<string | undefined>
  /** Deliver the answer to the calling app (native module in production). */
  complete: (result: Nip55Result) => void
  /**
   * Record the NIP-55 caller as a synthetic connection (Connected-apps listing) on login
   * approval — the recordWebSignIn pattern, but keyed by the Android caller package. NO
   * grant is written: every sign_event raises its own fresh approval (policy B).
   * Fail-open: a listing failure never blocks the login answer.
   */
  recordConnection?: (callerPackage: string | null | undefined) => Promise<void>
  /**
   * Record a metadata-only activity entry under the caller's pseudo-client key (the
   * Connected-apps activity screen — "so people can go back and see what they approved").
   * The runtime wires this STRAIGHT to the activity log (recordWebSignIn precedent — no
   * bumpAwaiting side effect). Fire-and-forget; never blocks or fails the answer.
   */
  recordActivity?: (
    clientPubkey: string,
    entry: { method: string; accepted: boolean; eventKind?: number },
  ) => void
  /** Metadata-only log sink (never plaintext/keys). */
  log?: (fields: Record<string, string | number>) => void
}

export interface Nip55Handler {
  handle(raw: Nip55PendingRequest): Promise<void>
}

/** Origin-bind key for a NIP-98 (27235) approval entry — same derivation as the runtime. */
const uHostForSign = (event: {
  kind?: number
  tags?: string[][]
}): string | null | undefined => {
  if (event.kind !== NIP98_KIND) return undefined
  const uTag = event.tags?.find((t) => t[0] === "u")?.[1] ?? null
  return uTag ? normalizeHost(uTag) : null
}

export const createNip55Handler = (ports: Nip55HandlerPorts): Nip55Handler => {
  const { signer, coordinator, complete, log } = ports

  const reject = (raw: Nip55PendingRequest, reason: string): void => {
    log?.({ nip55: "rejected", requestType: raw.type, reason })
    complete(rejectionForType(raw))
  }

  return {
    async handle(raw: Nip55PendingRequest): Promise<void> {
      const parsed = parseNip55Request(raw)
      if (parsed === null) {
        reject(raw, "unparseable-request")
        return
      }

      // Identity must be readable (flag-adjacent keystore availability); fail-closed.
      let userNpub: string
      try {
        userNpub = await signer.getPublicKey()
      } catch {
        reject(raw, "identity-unavailable")
        return
      }
      const userHex = toHexPubkey(nip19.decode(userNpub).data as string)
      if (userHex === null) {
        reject(raw, "identity-unreadable")
        return
      }

      const entryId = raw.id ?? `nip55:${ports.now()}`
      const clientPubkey = pseudoClientKey(raw.callerPackage)
      const callerLabel = raw.callerPackage ?? raw.referrer ?? "Android app"

      if (parsed.type === "get_public_key") {
        // Login consent: ONE connection-style approval — the surface copy is this exact
        // consent ("wants to sign you in and sign events on your behalf"). No grant is
        // persisted, so every future request re-prompts (prompt-by-default, Amber parity).
        const decision = await coordinator.enqueue({
          id: entryId,
          kind: "connection",
          clientPubkey,
          metadata: {
            name: callerLabel,
            ...(raw.referrer ? { url: raw.referrer } : {}),
          },
        })
        if (decision.approved) {
          // Synthetic Connected-apps record FIRST (few-ms AsyncStorage write), then answer —
          // the answer triggers the native auto-return, and the record must exist by then.
          await ports.recordConnection?.(raw.callerPackage).catch(() => undefined)
          ports.recordActivity?.(clientPubkey, { method: "connect", accepted: true })
          log?.({ nip55: "login-approved", caller: callerLabel })
          complete({ kind: "login_ok", pubkeyHex: userHex, id: raw.id })
        } else {
          log?.({ nip55: "login-rejected", caller: callerLabel })
          complete({ kind: "login_reject", id: raw.id })
        }
        return
      }

      // sign_event: the caller must already hold OUR pubkey (current_user); a mismatch is
      // rejected BEFORE any approval surface — the NIP-55 analog of AD-16.
      if (parsed.currentUserHex !== userHex) {
        ports.recordActivity?.(clientPubkey, {
          method: "sign_event",
          accepted: false,
          eventKind: parsed.params.kind,
        })
        reject(raw, "current-user-mismatch")
        return
      }

      const lightningAddress = await ports.readLightningAddress?.().catch(() => undefined)
      const flow = createSignEventFlow({
        signer,
        userNpub,
        now: ports.now,
        lightningAddress,
        requestApproval: (event) => {
          // H3 binding (mirrors runSignEvent): capture scope at raise, void the approval
          // if the identity or account scope changed by the time the human decided.
          const scopeAtRaise = ports.accountScopeKey?.() ?? null
          return coordinator
            .enqueue({
              id: entryId,
              kind: "request",
              clientPubkey,
              method: "sign_event",
              eventKind: event.kind,
              uHost: uHostForSign(event),
              humanAction: "sign-in-and-sign",
              contentPreview: formatSignEventPanel(buildSignEventPreview(event)),
            })
            .then(async (decision) => {
              if (!decision.approved) return { approved: false }
              const [scopeNow, npubNow] = await Promise.all([
                Promise.resolve(ports.accountScopeKey?.() ?? null),
                signer.getPublicKey().catch(() => null),
              ])
              return { approved: scopeNow === scopeAtRaise && npubNow === userNpub }
            })
        },
      })

      // Hermes note (see sign-event.ts): keep the awaited call in its own statement.
      let result: Awaited<ReturnType<typeof flow.handle>> | null = null
      try {
        result = await flow.handle(parsed.params)
      } catch {
        result = null
      }
      if (result && result.ok) {
        ports.recordActivity?.(clientPubkey, {
          method: "sign_event",
          accepted: true,
          eventKind: parsed.params.kind,
        })
        log?.({ nip55: "signed", eventKind: parsed.params.kind })
        complete({
          kind: "sign_ok",
          eventJson: JSON.stringify(result.event),
          sig: result.event.sig,
          id: raw.id,
        })
      } else {
        ports.recordActivity?.(clientPubkey, {
          method: "sign_event",
          accepted: false,
          eventKind: parsed.params.kind,
        })
        log?.({ nip55: "sign-rejected", eventKind: parsed.params.kind })
        complete({ kind: "sign_reject", id: raw.id })
      }
    },
  }
}
