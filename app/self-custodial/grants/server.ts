/**
 * Resolve the lnurl-server base URL from a self-custodial account's Lightning Address
 * (the address's domain hosts the D1/D2 endpoints). Known domains map to explicit bases;
 * anything else falls back to https://<domain>.
 */

const DOMAIN_TO_BASE: Record<string, string> = {
  // Devbox / POC server (feature-request E2E target) — apex since the 2026-08-25
  // cutover. The retired subdomain maps to the apex so pre-cutover demo accounts
  // (registered as user@lnurl.twentyone.ist) keep working against the live server.
  "twentyone.ist": "https://twentyone.ist",
  "lnurl.twentyone.ist": "https://twentyone.ist",
}

export const grantServerForAddress = (address: string): string => {
  const domain = address.split("@")[1]?.trim().toLowerCase()
  if (!domain) {
    throw new Error(`invalid lightning address: ${address}`)
  }
  return DOMAIN_TO_BASE[domain] ?? `https://${domain}`
}
