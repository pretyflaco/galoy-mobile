/**
 * D2 Delegated Receive Grant API client (feature-request-lnbits-delegated-grants.md).
 *
 * The grant exists on the lnurl-server only after a successful POST; the signature scheme
 * MUST match the server's validate() exactly:
 *   message  = `grant:{delegated_pubkey}:{expiry_secs}`   (revocation: `revoke:{...}`)
 *   digest   = sha256(message)
 *   signature= ECDSA/secp256k1 over the digest, DER hex — produced by the Spark identity
 *              key via the bridge seam (signMessageWithIdentityKey).
 * expiry is capped at 365d by the server; the delegated key must differ from the identity
 * key; rebinding a delegated key to another owner is rejected (hijack guard).
 *
 * The DRGK private key never reaches this module — callers pass only pubkeys and hold the
 * private hex in memory for the success screen.
 */

/** Server-enforced maximum grant lifetime. */
export const MAX_GRANT_EXPIRY_SECS = 365 * 24 * 60 * 60

export type SignGrantMessage = (
  message: string,
) => Promise<{ pubkey: string; signature: string }>

export interface GrantRecord {
  /** 33-byte compressed delegated pubkey hex (also the list/revoke identifier). */
  delegatedPubkey: string
  ownerPubkey: string
  lightningAddress: string
  /** Absolute unix-seconds expiry as registered with the server. */
  expiresAtSecs: number
}

const assertValidExpiry = (expirySecs: number): void => {
  if (
    !Number.isInteger(expirySecs) ||
    expirySecs <= 0 ||
    expirySecs > MAX_GRANT_EXPIRY_SECS
  ) {
    throw new Error(
      `invalid expiry: must be an integer within (0, ${MAX_GRANT_EXPIRY_SECS}] seconds`,
    )
  }
}

/** The exact canonical string the server verifies — exported for approval-screen tests. */
export const grantMessage = (delegatedPubkey: string, expirySecs: number): string =>
  `grant:${delegatedPubkey}:${expirySecs}`

/**
 * The server's validate() (account.rs) appends `-{timestamp}` to the canonical message
 * before verification, and the SAME timestamp must go in the request — the client signs
 * the timestamp-suffixed string so the freshness check and the signature cover each other.
 */
export const signedGrantMessage = (
  delegatedPubkey: string,
  expirySecs: number,
  timestamp: number,
): string => `${grantMessage(delegatedPubkey, expirySecs)}-${timestamp}`

export const signedRevokeMessage = (delegatedPubkey: string, timestamp: number): string =>
  `revoke:${delegatedPubkey}-${timestamp}`

export class GrantApiError extends Error {
  constructor(
    public readonly kind:
      | "invalid-pubkey"
      | "identity-key-delegation"
      | "invalid-expiry"
      | "invalid-signature"
      | "rate-limit"
      | "conflict"
      | "not-found"
      | "network",
    message: string,
  ) {
    super(message)
  }
}

const mapServerError = (status: number, body: string): GrantApiError => {
  const text = body.toLowerCase()
  if (status === 429) {
    return new GrantApiError("rate-limit", "too many requests — try again later")
  }
  if (status === 404) {
    // The address's domain resolved to a server without the D2 endpoints (e.g. an address
    // still registered on a server that only implements D1/LNURL-pay).
    return new GrantApiError("not-found", body || "grant endpoint not found")
  }
  if (text.includes("cannot delegate to the identity key")) {
    return new GrantApiError("identity-key-delegation", body)
  }
  if (text.includes("invalid pubkey")) {
    return new GrantApiError("invalid-pubkey", body)
  }
  if (text.includes("invalid expiry") || text.includes("expiry")) {
    return new GrantApiError("invalid-expiry", body)
  }
  if (text.includes("invalid signature") || text.includes("invalid timestamp")) {
    return new GrantApiError("invalid-signature", body)
  }
  if (status === 409) {
    return new GrantApiError("conflict", body)
  }
  return new GrantApiError("network", `grant request failed (${status}): ${body}`)
}

const request = async (base: string, path: string, init?: RequestInit): Promise<void> => {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, init)
  } catch {
    throw new GrantApiError("network", "could not reach the grant server")
  }
  if (!response.ok) {
    throw mapServerError(response.status, await response.text().catch(() => ""))
  }
}

export interface CreateGrantParams {
  base: string
  lightningAddress: string
  /** Freshly generated DRGK compressed pubkey (33-byte hex). */
  delegatedPubkey: string
  /** Requested lifetime in seconds; the server stores now + expiry. */
  expirySecs: number
  /** Injected signing seam (bridge signMessageWithIdentityKey bound to the live sdk). */
  signGrantMessage: SignGrantMessage
}

/**
 * Sign and register a delegated receive grant. One tap = sign + register: the owner
 * signature covers `grant:{drgk_pubkey}:{expiry_secs}` and the POST carries it with a
 * fresh timestamp for the server's freshness window.
 */
export const createDelegatedGrant = async ({
  base,
  lightningAddress,
  delegatedPubkey,
  expirySecs,
  signGrantMessage,
}: CreateGrantParams): Promise<GrantRecord> => {
  assertValidExpiry(expirySecs)

  // Sign first: the response's pubkey IS the owner identity pubkey the endpoint needs.
  // The timestamp is fixed BEFORE signing — the server verifies the signature over
  // `grant:{drgk}:{expiry}-{timestamp}` and rejects if body timestamp differs.
  const timestamp = Math.floor(Date.now() / 1000)
  const { pubkey: ownerPubkey, signature } = await signGrantMessage(
    signedGrantMessage(delegatedPubkey, expirySecs, timestamp),
  )
  if (ownerPubkey.toLowerCase() === delegatedPubkey.toLowerCase()) {
    throw new GrantApiError(
      "identity-key-delegation",
      "delegated key equals the identity key",
    )
  }

  await request(base, `/lnurlpay/${ownerPubkey}/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // eslint-disable-next-line camelcase
      delegated_pubkey: delegatedPubkey,
      // eslint-disable-next-line camelcase
      expiry_secs: expirySecs,
      timestamp,
      signature,
    }),
  })

  return {
    delegatedPubkey,
    ownerPubkey,
    lightningAddress,
    // Registered lifetime anchored at signing time (server anchors at receipt; POC-level
    // approximation good enough for the countdown UI).
    expiresAtSecs: Math.floor(Date.now() / 1000) + expirySecs,
  }
}

/**
 * Revoke a delegated grant: DELETE with the owner signature over
 * `revoke:{delegated_pubkey}-{timestamp}`. The server reads signature + timestamp from
 * the QUERY STRING (Query<RevokeDelegatedKeyParams>), not a body.
 */
export const revokeDelegatedGrant = async ({
  base,
  ownerPubkey,
  delegatedPubkey,
  signGrantMessage,
}: Omit<CreateGrantParams, "expirySecs" | "delegatedPubkey" | "lightningAddress"> & {
  ownerPubkey: string
  delegatedPubkey: string
}): Promise<void> => {
  const timestamp = Math.floor(Date.now() / 1000)
  const { signature } = await signGrantMessage(
    signedRevokeMessage(delegatedPubkey, timestamp),
  )
  const query = `signature=${encodeURIComponent(signature)}&timestamp=${timestamp}`
  await request(base, `/lnurlpay/${ownerPubkey}/grant/${delegatedPubkey}?${query}`, {
    method: "DELETE",
  })
}
