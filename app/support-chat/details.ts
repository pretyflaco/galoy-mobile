/**
 * "Share details" (M19): the customer shares the identifiers support needs — app version,
 * account type, account ID / wallet identifier, Lightning address, or one transaction —
 * as ONE chat message the customer reviewed first. The content is readable text (any
 * Marmot client shows it, and the relay mirrors it as-is); the tags carry the same values
 * structured for the relay:
 *   ["blink-details", "account" | "transaction"], ["detail", <key>, <value>]…
 * Support can ask for them: a message from the roster's BOT carrying
 *   ["blink-request", "details" | "tx"]
 * is shown with a "Review & share" button (only the verified bot may ask — client.ts).
 * Labels are English on purpose: the text is read by the support team, not the customer.
 */
import type { TransactionFragment } from "@app/graphql/generated"

export type DetailField = { key: string; label: string; value: string }
export type DetailsKind = "account" | "transaction"
export type RequestKind = "details" | "tx"

export const DETAILS_TAG = "blink-details"
export const REQUEST_TAG = "blink-request"

export const detailsText = (kind: DetailsKind, fields: DetailField[]): string =>
  [
    kind === "account" ? "My app & account details:" : "Details of the payment I mean:",
    ...fields.map((f) => `• ${f.label}: ${f.value}`),
  ].join("\n")

export const detailsTags = (kind: DetailsKind, fields: DetailField[]): string[][] => [
  [DETAILS_TAG, kind],
  ...fields.map((f) => ["detail", f.key, f.value]),
]

/** A support request carried by a message, if any ("details" | "tx"). */
export const requestOf = (tags: string[][] | undefined): RequestKind | null => {
  const t = tags?.find((x) => x[0] === REQUEST_TAG)?.[1]
  return t === "details" || t === "tx" ? t : null
}

export const isDetailsMessage = (tags: string[][] | undefined): boolean =>
  Boolean(tags?.some((x) => x[0] === DETAILS_TAG))

const short = (iso: string) => iso.replace("T", " ").replace(/\.\d+Z$/, " UTC")

/**
 * The fields of one transaction. `ids` overrides the fragment's hash fields: for
 * self-custodial payments the fragment holds the Breez payment id there, and the real
 * payment hash / txid come from the SDK payment details (use-share-details.ts).
 */
export const transactionFields = (
  tx: TransactionFragment,
  ids: { paymentHash?: string; txid?: string; paymentId?: string } = {},
): DetailField[] => {
  const out: DetailField[] = []
  const when = tx.createdAt ? new Date(tx.createdAt * 1000).toISOString() : null
  if (when) out.push({ key: "date", label: "Date", value: short(when) })
  out.push({
    key: "direction",
    label: "Direction",
    value: tx.direction === "SEND" ? "sent" : "received",
  })
  out.push({
    key: "amount",
    label: "Amount",
    value: `${Math.abs(tx.settlementAmount)} ${tx.settlementCurrency === "BTC" ? "sats" : "USD cents"}`,
  })
  out.push({ key: "status", label: "Status", value: String(tx.status).toLowerCase() })
  const initiation = tx.initiationVia
  const settlement = tx.settlementVia
  const lnHash =
    ids.paymentHash ??
    (initiation?.__typename === "InitiationViaLn" && !ids.paymentId
      ? initiation.paymentHash
      : undefined)
  const txid =
    ids.txid ??
    (settlement?.__typename === "SettlementViaOnChain" && !ids.paymentId
      ? settlement.transactionHash ?? undefined
      : undefined)
  if (lnHash) out.push({ key: "payment_hash", label: "Payment hash", value: lnHash })
  if (txid) out.push({ key: "txid", label: "Transaction ID", value: txid })
  if (ids.paymentId)
    out.push({ key: "payment_id", label: "Wallet payment ID", value: ids.paymentId })
  else out.push({ key: "transaction_id", label: "Blink transaction ID", value: tx.id })
  return out
}
