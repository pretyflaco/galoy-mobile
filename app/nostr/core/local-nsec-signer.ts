/**
 * LocalNsecSigner — the local implementation of the NostrSigner seam (Story 1.3 / AD-2).
 *
 * This is the SOLE code path that reads the nsec (enforced by the app/nostr nsec-read
 * ESLint boundary). It produces standard BIP-340 Schnorr signatures (via @noble/curves)
 * verifiable against the user npub, and is swappable behind the seam with zero consumer
 * change (a future FrostrSigner replaces it, AD-2 / FR-1).
 *
 * Internally all pubkeys are hex lowercase; bech32 (npub) appears only at the seam edge
 * (getPublicKey) via nostr-tools nip19. AD-1: core is UI-free.
 *
 * nsec is NOT read here directly from the keychain — it is provided by an injected
 * `readNsecHex` port (the keystore reader wired at signer-enable). Keeping the read
 * behind a port keeps this file the single nsec-interpreting boundary and makes it
 * unit-testable without the native keychain.
 */
import { schnorr } from "@noble/curves/secp256k1.js"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { getEventHash } from "nostr-tools/pure"
import * as nip19 from "nostr-tools/nip19"

import { secureRandomBytes } from "./keygen"
import {
  makeSignerError,
  type EventTemplate,
  type NostrSigner,
  type SignedEvent,
  type SignerCapabilities,
} from "./signer"

/** Port the signer reads its identity secret through (wired to the keystore at enable). */
export interface NsecSource {
  /** Returns the identity secret as lowercase hex, or throws if unavailable. */
  readNsecHex(signal?: AbortSignal): Promise<string>
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw makeSignerError("aborted", "operation aborted before completion")
  }
}

const capabilities: SignerCapabilities = {
  custodyLocal: true,
  canBackup: true,
  multiParty: false,
}

export const createLocalNsecSigner = (source: NsecSource): NostrSigner => {
  const loadSecretBytes = async (signal?: AbortSignal): Promise<Uint8Array> => {
    throwIfAborted(signal)
    let hex: string
    try {
      hex = await source.readNsecHex(signal)
    } catch (cause) {
      throw makeSignerError("unavailable", "identity key unavailable", cause)
    }
    throwIfAborted(signal)
    return hexToBytes(hex)
  }

  const xOnlyPubHex = async (signal?: AbortSignal): Promise<string> => {
    const sk = await loadSecretBytes(signal)
    return bytesToHex(schnorr.getPublicKey(sk))
  }

  const getPublicKey = async (signal?: AbortSignal): Promise<string> => {
    // Seam edge: return bech32 npub. Internals stay hex.
    return nip19.npubEncode(await xOnlyPubHex(signal))
  }

  const signEvent = async (
    event: EventTemplate,
    signal?: AbortSignal,
  ): Promise<SignedEvent> => {
    const sk = await loadSecretBytes(signal)
    const pubkey = bytesToHex(schnorr.getPublicKey(sk))
    const unsigned = { ...event, pubkey }
    const id = getEventHash(unsigned)
    throwIfAborted(signal)
    // Explicit auxRand injection (AD-6) — never a library default RNG.
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk, secureRandomBytes(32)))
    return { ...unsigned, id, sig }
  }

  const unsupportedEncryption = (name: string) => async (): Promise<never> => {
    throw makeSignerError("unavailable", `${name} not implemented until Story 3.6`)
  }

  return {
    getPublicKey,
    signEvent,
    nip04Encrypt: unsupportedEncryption("nip04Encrypt"),
    nip04Decrypt: unsupportedEncryption("nip04Decrypt"),
    nip44Encrypt: unsupportedEncryption("nip44Encrypt"),
    nip44Decrypt: unsupportedEncryption("nip44Decrypt"),
    capabilities,
  }
}
