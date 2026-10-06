/**
 * Second-domain Lightning Address registration (signed REST, no SDK reconnect).
 *
 * An account's SDK is bound to ONE lnurl server (its `lnurlDomain` is fixed at connect
 * time), so the SDK can only register and know addresses on that domain. Holding an
 * address on the OTHER mainnet domain — a blink.sv address to unlock Ways-to-get-paid,
 * or a twentyone.ist address to stay payable in Incognito — is done here instead: the
 * same signed REST contract the SDK itself uses against the server:
 *
 *   availability  GET  {base}/lnurlpay/available/{username}     → { available: bool }
 *   register      POST {base}/lnurlpay/{pubkey}
 *                        { username, signature, timestamp, description }
 *                 where signature is the wallet IDENTITY-key signature (DER hex) over
 *                 `"{username}-{timestamp}"` — the server's validate() (account.rs)
 *                 canonicalizes the username to lowercase BEFORE verifying, so the
 *                 client must sign the canonical form. Produced via the bridge seam
 *                 signMessageWithIdentityKey bound to the live sdk (same scheme as the
 *                 D2 grant client).
 *
 * The registered address settles through Spark regardless of which server advertises
 * it, so the wallet receives on both domains without the SDK ever reconnecting.
 */

export type SignLnurlMessage = (
  message: string,
) => Promise<{ pubkey: string; signature: string }>

/** Server-side canonical form (identifier.rs checked_to_username): trim + lowercase. */
export const canonicalUsername = (username: string): string =>
  username.trim().toLowerCase()

/** The exact string the server verifies — canonical username plus the freshness timestamp. */
export const signedRegisterMessage = (username: string, timestamp: number): string =>
  `${canonicalUsername(username)}-${timestamp}`

export class LnurlRegisterError extends Error {
  constructor(
    public readonly kind:
      | "taken"
      | "invalid-username"
      | "enhanced-mode-required"
      | "invalid-signature"
      | "rate-limit"
      | "network",
    message: string,
  ) {
    super(message)
  }
}

const mapServerError = (status: number, body: string): LnurlRegisterError => {
  const text = body.toLowerCase()
  if (status === 429) {
    return new LnurlRegisterError("rate-limit", "too many requests — try again later")
  }
  if (text.includes("enhanced mode required") || text.includes("enhanced_mode")) {
    return new LnurlRegisterError("enhanced-mode-required", body)
  }
  if (text.includes("invalid username")) {
    return new LnurlRegisterError("invalid-username", body)
  }
  if (text.includes("invalid signature") || text.includes("invalid timestamp")) {
    return new LnurlRegisterError("invalid-signature", body)
  }
  if (status === 409 || text.includes("already") || text.includes("taken")) {
    return new LnurlRegisterError("taken", body || "address is already taken")
  }
  return new LnurlRegisterError("network", `register request failed (${status}): ${body}`)
}

const request = async <T>(base: string, path: string, init?: RequestInit): Promise<T> => {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, init)
  } catch {
    throw new LnurlRegisterError("network", "could not reach the lnurl server")
  }
  if (!response.ok) {
    throw mapServerError(response.status, await response.text().catch(() => ""))
  }
  return response.json() as Promise<T>
}

/** Whether `username` can still be claimed on the server's domain. */
export const checkAddressAvailableOnDomain = async (
  base: string,
  username: string,
): Promise<boolean> => {
  const result = await request<{ available: boolean }>(
    base,
    `/lnurlpay/available/${encodeURIComponent(canonicalUsername(username))}`,
  )
  return result.available
}

export interface RegisterAddressParams {
  /** Base URL of the target domain's lnurl server, e.g. https://blink.sv. */
  base: string
  username: string
  /** Injected signing seam (bridge signMessageWithIdentityKey bound to the live sdk). */
  signMessage: SignLnurlMessage
}

/**
 * Claim `username` on the target domain. The timestamp is fixed BEFORE signing — the
 * server verifies the signature over `{username}-{timestamp}` and rejects if the body's
 * timestamp differs. Returns the canonical `username@domain` address the server
 * confirmed.
 */
export const registerAddressOnDomain = async ({
  base,
  username,
  signMessage,
}: RegisterAddressParams): Promise<string> => {
  const canonical = canonicalUsername(username)
  const timestamp = Math.floor(Date.now() / 1000)
  const { pubkey, signature } = await signMessage(
    signedRegisterMessage(canonical, timestamp),
  )

  const result = await request<{ lightning_address: string }>(
    base,
    `/lnurlpay/${pubkey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: canonical,
        signature,
        timestamp,
        description: `Pay ${canonical}@${new URL(base).host}`,
      }),
    },
  )
  return result.lightning_address
}
