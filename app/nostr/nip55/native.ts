/**
 * RN bridge wrapper for the native NIP-55 module (Android only).
 *
 * Falls back to inert no-ops when the module is absent (iOS, tests, or a JS bundle running
 * against a stale native binary) — an absent signer surface must never crash the host app
 * (NFR-9). A missing module simply yields no pending requests and completes nothing.
 */
import { NativeModules } from "react-native"

export interface Nip55NativeModule {
  /** One-shot read of the pending request JSON (null when none); see Nip55PendingStore. */
  consumePending(): Promise<string | null>
  /** Deliver a serialized Nip55Result to the calling app and close the holder activity. */
  complete(resultJson: string): void
  /** Mirror nostrSignerEnabled onto the manifest component (chooser visibility, AD-13). */
  setEnabled(enabled: boolean): void
}

const inertFallback: Nip55NativeModule = {
  consumePending: async () => null,
  complete: () => undefined,
  setEnabled: () => undefined,
}

export const Nip55Native: Nip55NativeModule = NativeModules.Nip55Signer ?? inertFallback
