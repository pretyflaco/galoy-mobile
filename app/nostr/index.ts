/** Public surface of the nostr-signer module. */
export type {
  NostrSigner,
  SignerError,
  SignerErrorCode,
  SignerCapabilities,
  EventTemplate,
  SignedEvent,
} from "./core/signer"
export { isSignerError, makeSignerError } from "./core/signer"
