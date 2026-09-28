/**
 * NIP-55 handler — the two request shapes against the REAL seams: approval entries through
 * a scriptable coordinator fake, signing through the REAL LocalNsecSigner (the result
 * verifies with nostr-tools). Verifies the login consent entry shape, the current_user
 * mismatch pre-approval rejection (AD-16 analog), the H3 scope re-check, and the
 * result-extra mapping the native module serializes for the calling app.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import { verifyEvent } from "nostr-tools/pure"

import type {
  ApprovalCoordinator,
  ApprovalDecision,
  ApprovalEntry,
} from "../../app/nostr/approval/coordinator"
import { createLocalNsecSigner } from "../../app/nostr/core/local-nsec-signer"
import { createNip55Handler } from "../../app/nostr/nip55/handler"
import type { Nip55PendingRequest, Nip55Result } from "../../app/nostr/nip55/types"

const userSk = new Uint8Array(32).fill(4)
const userSkHex = bytesToHex(userSk)
const userPubHex = bytesToHex(schnorr.getPublicKey(userSk))
const NOW = 1_800_000_000
const SIG_HEX_128 = expect.stringMatching(/^[0-9a-f]{128}$/)

/** Scriptable coordinator fake: records entries, decides per-script. */
const makeCoordinator = (
  decide: (entry: ApprovalEntry) => ApprovalDecision = () => ({ approved: true }),
) => {
  const entries: ApprovalEntry[] = []
  const listeners = new Set<() => void>()
  const coordinator: ApprovalCoordinator = {
    enqueue: async (entry) => {
      entries.push(entry)
      return decide(entry)
    },
    resolveActive: () => undefined,
    queueDepth: () => 0,
    activeEntry: () => null,
    pendingEntries: () => entries,
    resolveMany: () => undefined,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    runExclusive: async (commit) => commit(),
    isEpochValid: () => true,
  }
  return { coordinator, entries }
}

const makeHandler = (
  coordinator: ApprovalCoordinator,
  results: Nip55Result[],
  opts?: { accountScopeKey?: () => string | null },
) => {
  const signer = createLocalNsecSigner({ readNsecHex: async () => userSkHex })
  const handler = createNip55Handler({
    signer,
    coordinator,
    now: () => NOW,
    accountScopeKey: opts?.accountScopeKey,
    complete: (result) => results.push(result),
  })
  return { handler, signer }
}

const LOGIN: Nip55PendingRequest = {
  type: "get_public_key",
  id: "req-login",
  permissions: '[{"type":"sign_event","kind":27235}]',
  callerPackage: "com.vezir.android",
}

const signRequest = (overrides?: Partial<Nip55PendingRequest>): Nip55PendingRequest => {
  const event = {
    id: "cafe".repeat(16), // untrusted — recomputed by the flow
    pubkey: userPubHex,
    // eslint-disable-next-line camelcase
    created_at: NOW,
    kind: 27235,
    tags: [
      ["u", "https://vezir.twentyone.ist/api/auth/nostr/login"],
      ["method", "POST"],
    ],
    content: "",
  }
  return {
    type: "sign_event",
    id: "req-sign",
    data: `nostrsigner:${encodeURIComponent(JSON.stringify(event))}`,
    currentUser: userPubHex,
    callerPackage: "com.vezir.android",
    ...overrides,
  }
}

describe("get_public_key (login consent)", () => {
  it("raises ONE connection-style approval and answers login_ok with the hex pubkey", async () => {
    const { coordinator, entries } = makeCoordinator()
    const results: Nip55Result[] = []
    const { handler } = makeHandler(coordinator, results)

    await handler.handle(LOGIN)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: "req-login",
      kind: "connection",
      clientPubkey: "nip55:com.vezir.android",
      metadata: { name: "com.vezir.android" },
    })
    expect(results).toEqual([
      { kind: "login_ok", pubkeyHex: userPubHex, id: "req-login" },
    ])
  })

  it("answers login_reject when the human rejects", async () => {
    const { coordinator } = makeCoordinator(() => ({ approved: false }))
    const results: Nip55Result[] = []
    const { handler } = makeHandler(coordinator, results)

    await handler.handle(LOGIN)

    expect(results).toEqual([{ kind: "login_reject", id: "req-login" }])
  })

  it("records the caller as a synthetic connection on approval (NO grant, policy B)", async () => {
    const { coordinator } = makeCoordinator()
    const results: Nip55Result[] = []
    const recordConnection = jest.fn(async () => undefined)
    const signer = createLocalNsecSigner({ readNsecHex: async () => userSkHex })
    const handler = createNip55Handler({
      signer,
      coordinator,
      now: () => NOW,
      complete: (result) => results.push(result),
      recordConnection,
    })

    await handler.handle(LOGIN)

    // The record is written BEFORE the answer (the answer triggers the native auto-return).
    expect(recordConnection).toHaveBeenCalledTimes(1)
    expect(recordConnection).toHaveBeenCalledWith("com.vezir.android")
    expect(results).toEqual([
      { kind: "login_ok", pubkeyHex: userPubHex, id: "req-login" },
    ])
  })

  it("records activity: connect on login approval, sign_event with kind + acceptance", async () => {
    const { coordinator } = makeCoordinator()
    const results: Nip55Result[] = []
    const activity: Array<[string, Record<string, unknown>]> = []
    const signer = createLocalNsecSigner({ readNsecHex: async () => userSkHex })
    const handler = createNip55Handler({
      signer,
      coordinator,
      now: () => NOW,
      complete: (result) => results.push(result),
      recordActivity: (clientPubkey, entry) => {
        activity.push([clientPubkey, { ...entry }])
      },
    })

    await handler.handle(LOGIN)
    await handler.handle(signRequest())

    // Entries land under the caller's pseudo-key, mirroring the NIP-46 session shape
    // (Connect, then Signed event) — the Connected-apps activity screen renders these.
    expect(activity).toEqual([
      ["nip55:com.vezir.android", { method: "connect", accepted: true }],
      [
        "nip55:com.vezir.android",
        { method: "sign_event", accepted: true, eventKind: 27235 },
      ],
    ])
  })

  it("records sign_event rejected entries (human reject + current_user mismatch); nothing on login reject", async () => {
    const rejecting = makeCoordinator(() => ({ approved: false }))
    const results: Nip55Result[] = []
    const activity: Array<[string, Record<string, unknown>]> = []
    const signer = createLocalNsecSigner({ readNsecHex: async () => userSkHex })
    const handler = createNip55Handler({
      signer,
      coordinator: rejecting.coordinator,
      now: () => NOW,
      complete: (result) => results.push(result),
      recordActivity: (clientPubkey, entry) => {
        activity.push([clientPubkey, { ...entry }])
      },
    })

    await handler.handle(LOGIN) // rejected login ⇒ NO entry (NIP-46 parity)
    await handler.handle(signRequest()) // human rejects the sign ⇒ rejected entry
    await handler.handle(signRequest({ currentUser: "cd".repeat(32) })) // mismatch ⇒ rejected entry

    expect(activity).toEqual([
      [
        "nip55:com.vezir.android",
        { method: "sign_event", accepted: false, eventKind: 27235 },
      ],
      [
        "nip55:com.vezir.android",
        { method: "sign_event", accepted: false, eventKind: 27235 },
      ],
    ])
  })

  it("answers login_ok even when the record write fails (fail-open listing)", async () => {
    const { coordinator } = makeCoordinator()
    const results: Nip55Result[] = []
    const recordConnection = jest.fn(async () => {
      throw new Error("storage full")
    })
    const signer = createLocalNsecSigner({ readNsecHex: async () => userSkHex })
    const handler = createNip55Handler({
      signer,
      coordinator,
      now: () => NOW,
      complete: (result) => results.push(result),
      recordConnection,
    })

    await handler.handle(LOGIN)

    expect(results).toEqual([
      { kind: "login_ok", pubkeyHex: userPubHex, id: "req-login" },
    ])
  })
})

describe("sign_event", () => {
  it("approves, signs through the REAL seam, and returns a verifiable signed event + sig", async () => {
    const { coordinator, entries } = makeCoordinator()
    const results: Nip55Result[] = []
    const { handler } = makeHandler(coordinator, results)

    await handler.handle(signRequest())

    // The approval entry mirrors the NIP-46 login-sign path.
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: "request",
      method: "sign_event",
      eventKind: 27235,
      uHost: "vezir.twentyone.ist",
      // Fallback phrase only — the surface derives "log in to <uHost>" from the fields above.
      humanAction: "sign an event",
      // The exact panel travels alongside the bounded summary for the expander (SM-C3).
      contentPreviewFull: expect.stringContaining("kind: 27235"),
    })

    expect(results).toHaveLength(1)
    const result = results[0]
    expect(result.kind).toBe("sign_ok")
    if (result.kind !== "sign_ok") return
    expect(result.sig).toEqual(SIG_HEX_128)
    expect(result.id).toBe("req-sign")

    // The event extra is the full signed JSON and verifies with reference tooling.
    const signed = JSON.parse(result.eventJson)
    expect(verifyEvent(signed)).toBe(true)
    expect(signed.pubkey).toBe(userPubHex)
    expect(signed.kind).toBe(27235)
    expect(signed.sig).toBe(result.sig)
  })

  it("rejects a current_user mismatch BEFORE any approval surface (AD-16 analog)", async () => {
    const { coordinator, entries } = makeCoordinator()
    const results: Nip55Result[] = []
    const { handler } = makeHandler(coordinator, results)

    await handler.handle(signRequest({ currentUser: "cd".repeat(32) }))

    expect(entries).toHaveLength(0)
    expect(results).toEqual([{ kind: "sign_reject", id: "req-sign" }])
  })

  it("answers sign_reject when the human rejects", async () => {
    const { coordinator } = makeCoordinator(() => ({ approved: false }))
    const results: Nip55Result[] = []
    const { handler } = makeHandler(coordinator, results)

    await handler.handle(signRequest())

    expect(results).toEqual([{ kind: "sign_reject", id: "req-sign" }])
  })

  it("voids the approval when the account scope changed while the surface was up (H3)", async () => {
    let scope = "account-A"
    // Deferred coordinator: the human decision lands only after we flip the scope.
    let resolveDecision!: (decision: ApprovalDecision) => void
    let signalEnqueued!: () => void
    const enqueued = new Promise<void>((resolve) => {
      signalEnqueued = resolve
    })
    const decision = new Promise<ApprovalDecision>((resolve) => {
      resolveDecision = resolve
    })
    const coordinator: ApprovalCoordinator = {
      enqueue: async (_entry) => {
        signalEnqueued()
        return decision
      },
      resolveActive: () => undefined,
      queueDepth: () => 0,
      activeEntry: () => null,
      pendingEntries: () => [],
      resolveMany: () => undefined,
      subscribe: () => () => undefined,
      runExclusive: async (commit) => commit(),
      isEpochValid: () => true,
    }
    const results: Nip55Result[] = []
    const { handler } = makeHandler(coordinator, results, {
      accountScopeKey: () => scope,
    })

    const pending = handler.handle(signRequest())
    await enqueued // the entry was raised (scope captured as account-A)
    scope = "account-B" // the account switches while the surface is still up
    resolveDecision({ approved: true }) // ...and THEN the human approves
    await pending

    expect(results).toEqual([{ kind: "sign_reject", id: "req-sign" }])
  })
})

describe("fail-closed paths", () => {
  it("rejects an unparseable request per type without raising any surface", async () => {
    const { coordinator, entries } = makeCoordinator()
    const results: Nip55Result[] = []
    const { handler } = makeHandler(coordinator, results)

    // Grantable-gate violation on login + garbage event JSON on sign.
    await handler.handle({ ...LOGIN, permissions: '[{"type":"nip04_encrypt"}]' })
    await handler.handle(signRequest({ data: "nostrsigner:%zz" }))

    expect(entries).toHaveLength(0)
    expect(results).toEqual([
      { kind: "login_reject", id: "req-login" },
      { kind: "sign_reject", id: "req-sign" },
    ])
  })

  it("rejects when the identity cannot be read (signer unavailable)", async () => {
    const { coordinator } = makeCoordinator()
    const results: Nip55Result[] = []
    const handler = createNip55Handler({
      signer: {
        getPublicKey: async () => {
          throw new Error("keychain locked")
        },
        // Never reached.
        signEvent: async () => {
          throw new Error("unreachable")
        },
      },
      coordinator,
      now: () => NOW,
      complete: (result) => results.push(result),
    })

    await handler.handle(LOGIN)

    expect(results).toEqual([{ kind: "login_reject", id: "req-login" }])
  })
})
