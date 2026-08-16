/**
 * Request dispatcher (Story 3.2 / AD-16) — the pipeline's dispatch stage wired together.
 *
 * Composes the request ledger (AD-16/AD-17), the standard method handlers (AC #4), and the
 * respond-in-kind codec (AD-10) into the exactly-once request lifecycle:
 *
 *  - `new`               → run the handler, encode the response in-kind, SEND it, and record
 *                          it in the ledger (answered exactly once).
 *  - `answered` (redeliv) → re-SEND the STORED response without re-running the handler.
 *  - `pending-duplicate`  → drop (never re-surfaced / re-executed).
 *
 * This is the transport-layer dispatch for methods answerable without an approval surface
 * (ping / get_public_key / connect-ack). Approval-gated methods (sign_event, nip04_/nip44_)
 * are wired through the ApprovalCoordinator in Stories 3.4–3.6 and are not handled here.
 *
 * AD-1: transport is UI-free. The `send` port publishes the encoded response event (relay
 * pool, Story 3.1). Metadata-only logging.
 */
import type { Event } from "nostr-tools/pure"

import type { RequestLedger } from "@app/nostr/core/request-ledger"

import { encodeResponse, type DecodedRequest, type Nip46Response } from "./nip46-codec"
import { dispatchNip46Method, type MethodPorts } from "./nip46-methods"

export interface DispatcherPorts {
  ledger: RequestLedger
  methodPorts: MethodPorts
  /** Device-local transport secret (AD-4) used to encrypt/sign responses. */
  transportSk: string | Uint8Array
  /** Publish the encoded response event (bound to the relay pool, Story 3.1). */
  send: (event: Event) => void
}

export interface RequestDispatcher {
  dispatch(decoded: DecodedRequest, event: Event): Promise<void>
}

export const createRequestDispatcher = (ports: DispatcherPorts): RequestDispatcher => {
  const { ledger, methodPorts, transportSk, send } = ports

  const sendResponse = (response: Nip46Response, decoded: DecodedRequest): void => {
    send(
      encodeResponse(response, {
        scheme: decoded.scheme,
        clientPubkey: decoded.clientPubkey,
        transportSk,
      }),
    )
  }

  return {
    async dispatch(decoded: DecodedRequest): Promise<void> {
      const { clientPubkey, request } = decoded
      const seen = await ledger.register(clientPubkey, request.id)

      if (seen.status === "pending-duplicate") {
        // Already in flight — never re-surface / re-execute.
        return
      }

      if (seen.status === "answered") {
        // Redelivery of an answered request → re-send the stored response, no re-execution.
        if (seen.storedResponse !== undefined) {
          sendResponse(JSON.parse(seen.storedResponse) as Nip46Response, decoded)
        }
        return
      }

      // status === "new": execute the handler exactly once, answer, and record.
      const response = await dispatchNip46Method(request, methodPorts)
      await ledger.recordResponse(clientPubkey, request.id, JSON.stringify(response))
      sendResponse(response, decoded)
    },
  }
}
