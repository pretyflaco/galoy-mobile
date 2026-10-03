/**
 * NIP-55 (Android Nostr signer intents) types — the `nostrsigner://` protocol spoken by
 * vezir-android's "Sign in with Nostr" and Amber.
 *
 * Wire contract verified against vezir's `auth/Nip55Signer.kt` (client) and Amber's
 * `IntentUtils.kt` (reference signer):
 *  - `get_public_key` (login): bare `nostrsigner:` URI + extras `type`, `permissions`
 *    (JSON string, e.g. `[{"type":"sign_event","kind":27235}]`). Answer: `result` = pubkey
 *    (hex or npub — vezir Bech32-decodes), `package` = signer applicationId.
 *  - `sign_event`: `nostrsigner:<Uri.encode(unsigned event JSON)>` + extras `type`,
 *    `current_user` (hex). Answer: `event` = full signed event JSON (preferred by clients)
 *    and/or `result`/`signature` = bare 128-hex sig (client stitches it locally).
 *  - Rejection: `get_public_key` → plain finish (RESULT_CANCELED); other types → RESULT_OK
 *    with a `rejected` extra (presence-checked).
 */

/**
 * The raw intent payload extracted by the native holder activity (Nip55PendingStore) —
 * unparsed strings; ALL protocol parsing lives here in JS where nostr tooling lives.
 */
export interface Nip55PendingRequest {
  /** The `type` extra: "get_public_key" | "sign_event" (anything else is rejected). */
  type: string
  /** Request id (native mints a UUID when the caller sent none; echoed on results). */
  id?: string | null
  /** The raw (still percent-encoded) intent data URI, e.g. `nostrsigner:%7B…`. */
  data?: string | null
  /** The `current_user` extra (hex or npub) — must match OUR identity for sign_event. */
  currentUser?: string | null
  /** The `permissions` extra — JSON string, parsed + fail-closed validated. */
  permissions?: string | null
  /** Best-effort caller identity (getCallingPackage(); null when the chooser mediated). */
  callerPackage?: string | null
  /** Best-effort referrer URI (android-app://…) when the system populated one. */
  referrer?: string | null
}

/** The answers the handler can return; serialized to JSON for the native module. */
export type Nip55Result =
  | { kind: "login_ok"; pubkeyHex: string; id?: string | null }
  | { kind: "login_reject"; id?: string | null }
  | { kind: "sign_ok"; eventJson: string; sig: string; id?: string | null }
  | { kind: "sign_reject"; id?: string | null }
