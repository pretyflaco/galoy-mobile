/**
 * Origin (host) normalization for the 27235 pre-approval grant (NIP46 Plan A).
 *
 * The safety of pre-approving a kind-27235 (NIP-98) sign_event rests on ONE thing: the event's
 * `u`-tag host must equal the host the user consented to at connect time (`metadata.url`). Both
 * hosts are normalized THROUGH THIS SAME FUNCTION so the comparison is symmetric — a mismatch (or
 * any unparseable input) yields a non-match and the request falls back to a per-request approval.
 *
 * Host-only by design (locked decision): a NIP-98 login endpoint is `https://<host>/api/...` while
 * the connect `url` is the app BASE — they share host, not path or (necessarily) scheme. Comparing
 * full URLs would never match; comparing host is the app-identity anchor. Default ports are
 * stripped; a non-default port is kept (a different port is a different origin). Returns null on
 * unparseable input, which the policy treats as "no match" → prompt.
 */
export const normalizeHost = (raw: string): string | null => {
  if (!raw) return null
  try {
    const u = new URL(raw)
    // URL already lowercases + punycodes the hostname. Keep a non-default port.
    const isDefaultPort =
      (u.protocol === "https:" && (u.port === "" || u.port === "443")) ||
      (u.protocol === "http:" && (u.port === "" || u.port === "80"))
    return isDefaultPort ? u.hostname : `${u.hostname}:${u.port}`
  } catch {
    return null
  }
}
