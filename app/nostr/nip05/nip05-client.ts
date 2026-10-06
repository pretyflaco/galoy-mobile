/**
 * NIP-05 registration client (signed REST against the blink-lnurl-server).
 *
 * Two routes, one per custody mode — both bind the SAME thing: the account's
 * `username@domain` handle to a nostr pubkey, with dual proof:
 *
 *   spark  POST {base}/lnurlpay/{pubkey}/nostr
 *          { nostr_pubkey, nostr_proof, signature, timestamp }
 *          where signature is the wallet IDENTITY-key signature (DER hex) over
 *          `nostr:{nostr_pubkey}-{timestamp}` — same scheme as lnurl-register /
 *          the D2 grant client. Produced via the bridge seam
 *          signMessageWithIdentityKey bound to the live sdk.
 *
 *   blink  POST {base}/nostr/blink
 *          Authorization: Bearer <Blink session token>
 *          { nostr_pubkey, nostr_proof }
 *          The server validates the token server-side (GraphQL `me`) and requires
 *          the username to already be provisioned in its registry — the client
 *          never provisions identifiers.
 *
 * `nostr_proof` is the JSON of a kind-22242 event signed by the nostr key, carrying
 * an `lnaddress` tag equal to the handle (see nip05/proof.ts).
 *
 * The server returns the confirmed handle (`nip05`); re-registering is an idempotent
 * upsert, so retries and re-publishes are safe.
 */

/** Same seam type as lnurl-register (bridge signMessageWithIdentityKey bound to the sdk). */
export type SignNip05Message = (
  message: string,
) => Promise<{ pubkey: string; signature: string }>

/** The exact string the spark route verifies — nostr pubkey plus freshness timestamp. */
export const signedNostrRegisterMessage = (
  nostrPubkey: string,
  timestamp: number,
): string => `nostr:${nostrPubkey}-${timestamp}`

export interface Nip05Registration {
  username: string
  domain: string
  nostrPubkey: string
  /** Full internet identifier, e.g. `alice@blink.sv`. */
  nip05: string
}

export class Nip05RegisterError extends Error {
  constructor(
    public readonly kind:
      | "invalid-proof"
      | "invalid-signature"
      | "unauthorized"
      | "not-provisioned"
      | "conflict"
      | "rate-limit"
      | "network",
    message: string,
  ) {
    super(message)
  }
}

const mapServerError = (status: number, body: string): Nip05RegisterError => {
  const text = body.toLowerCase()
  if (status === 429) {
    return new Nip05RegisterError("rate-limit", "too many requests — try again later")
  }
  if (status === 401) {
    return new Nip05RegisterError("unauthorized", body || "invalid or expired token")
  }
  if (status === 404) {
    return new Nip05RegisterError("not-provisioned", body || "username not provisioned")
  }
  if (status === 409) {
    return new Nip05RegisterError(
      "conflict",
      body || "username belongs to another account",
    )
  }
  if (
    text.includes("nostr proof") ||
    text.includes("nostr pubkey") ||
    text.includes("lnaddress")
  ) {
    return new Nip05RegisterError("invalid-proof", body)
  }
  if (text.includes("invalid signature") || text.includes("invalid timestamp")) {
    return new Nip05RegisterError("invalid-signature", body)
  }
  return new Nip05RegisterError(
    "network",
    `nip05 registration failed (${status}): ${body}`,
  )
}

const request = async <T>(base: string, path: string, init?: RequestInit): Promise<T> => {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, init)
  } catch {
    throw new Nip05RegisterError("network", "could not reach the lnurl server")
  }
  if (!response.ok) {
    throw mapServerError(response.status, await response.text().catch(() => ""))
  }
  return response.json() as Promise<T>
}

interface RawRegistration {
  username: string
  domain: string
  nostr_pubkey: string
  nip05: string
}

const toRegistration = (raw: RawRegistration): Nip05Registration => ({
  username: raw.username,
  domain: raw.domain,
  nostrPubkey: raw.nostr_pubkey,
  nip05: raw.nip05,
})

export interface RegisterSparkNip05Params {
  /** Base URL of the account's lnurl server, e.g. https://blink.sv. */
  base: string
  /** Lowercase hex x-only nostr pubkey (64 chars) of the identity being bound. */
  nostrPubkey: string
  /** JSON of the signed kind-22242 proof event (see nip05/proof.ts). */
  nostrProof: string
  /** Injected signing seam (bridge signMessageWithIdentityKey bound to the live sdk). */
  signMessage: SignNip05Message
}

/** Bind a nostr key to a self-custodial (spark) account's handle. */
export const registerSparkNostrIdentity = async ({
  base,
  nostrPubkey,
  nostrProof,
  signMessage,
}: RegisterSparkNip05Params): Promise<Nip05Registration> => {
  const timestamp = Math.floor(Date.now() / 1000)
  const { pubkey, signature } = await signMessage(
    signedNostrRegisterMessage(nostrPubkey, timestamp),
  )
  const raw = await request<RawRegistration>(base, `/lnurlpay/${pubkey}/nostr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // eslint-disable-next-line camelcase -- server wire payload is snake_case
      nostr_pubkey: nostrPubkey,
      // eslint-disable-next-line camelcase -- server wire payload is snake_case
      nostr_proof: nostrProof,
      signature,
      timestamp,
    }),
  })
  return toRegistration(raw)
}

export interface RegisterBlinkNip05Params {
  /** Base URL of the lnurl server, e.g. https://blink.sv. */
  base: string
  /** The signed-in account's Blink session (auth) token — forwarded, never stored. */
  token: string
  nostrPubkey: string
  nostrProof: string
}

/** Bind a nostr key to a custodial (blink) account's provisioned username. */
export const registerBlinkNostrIdentity = async ({
  base,
  token,
  nostrPubkey,
  nostrProof,
}: RegisterBlinkNip05Params): Promise<Nip05Registration> => {
  const raw = await request<RawRegistration>(base, "/nostr/blink", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      // eslint-disable-next-line camelcase -- server wire payload is snake_case
      nostr_pubkey: nostrPubkey,
      // eslint-disable-next-line camelcase -- server wire payload is snake_case
      nostr_proof: nostrProof,
    }),
  })
  return toRegistration(raw)
}
