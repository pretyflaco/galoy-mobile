/**
 * LocalNsecSigner — local implementation of the NostrSigner seam (Story 1.3).
 *
 * This is one of the ONLY two files permitted to read nsec key material (AD-2/FR-1);
 * the ESLint nsec-boundary override excludes it. Implementation lands in Story 1.3.
 */
import type { NostrSigner } from "./signer"

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type LocalNsecSigner = NostrSigner
