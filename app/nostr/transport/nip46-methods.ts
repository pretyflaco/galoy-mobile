/**
 * Standard NIP-46 method handlers (Story 3.2 / AC #4 / AD-16 / AD-4).
 *
 * Handles the methods that are answerable at the transport layer without an approval surface:
 *  - `ping`           → `result: "pong"`.
 *  - `get_public_key` → `result: <user pubkey HEX>` (NIP-46 wire format — 64-char x-only hex,
 *                       NOT npub; every NIP-46 client, incl. the btcpay-nostr-login plugin,
 *                       rejects a bech32 npub here). The seam's display `getPublicKey()` returns
 *                       npub; the hex is supplied via the `getPublicKeyHex` port (AD-4).
 *  - `connect`        → `result: "ack"` (method-level acknowledgement; the full
 *                       nostrconnect:// handshake — secret echo, approval, ConnectionStore —
 *                       is owned by ConnectFlow in Story 3.3).
 *
 * Any OTHER method — including `switch_relays`, unsupported in v1 — returns a spec-conformant
 * error reply using the NIP-46 `error` field (never a `result`). `sign_event` and the
 * `nip04_*`/`nip44_*` capability methods are handled in their own stories (3.5 / 3.6) behind
 * approval; `logout` is a client-initiated disconnect (AD-8) handled in 3.7. Request ids and
 * method names are taken verbatim from the message.
 *
 * AD-1: transport is UI-free. This dispatcher returns a `Nip46Response`; the pipeline encodes
 * and sends it (respond-in-kind) and records it in the ledger.
 */
import type { Nip46Request, Nip46Response } from "./nip46-codec"

/** Ports the standard-method dispatcher needs (the seam's public-key read, AD-4). */
export interface MethodPorts {
  /**
   * Returns the user's x-only public key as lowercase HEX (64 chars) — the NIP-46 wire format
   * for get_public_key. NOT npub: a bech32 npub is rejected by NIP-46 clients (the plugin
   * requires `result.Length == 64 && all hex`). The runtime derives this from the seam.
   */
  getPublicKeyHex: (signal?: AbortSignal) => Promise<string>
}

/** Methods handled here at the transport layer (no approval surface required). */
const TRANSPORT_METHODS = new Set(["ping", "get_public_key", "connect"])

/** Methods explicitly deferred to later stories (documented; still not handled HERE). */
export const isTransportMethod = (method: string): boolean =>
  TRANSPORT_METHODS.has(method)

export const dispatchNip46Method = async (
  request: Nip46Request,
  ports: MethodPorts,
): Promise<Nip46Response> => {
  const { id, method } = request

  switch (method) {
    case "ping":
      return { id, result: "pong" }
    case "get_public_key":
      return { id, result: await ports.getPublicKeyHex() }
    case "connect":
      return { id, result: "ack" }
    default:
      // Unknown/unsupported (incl. switch_relays in v1) → spec error reply.
      return { id, error: `unsupported method: ${method}` }
  }
}
