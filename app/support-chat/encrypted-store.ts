/**
 * Encrypted GenericKeyValueStore for Marmot (from poc/support-chat-demo M6, unchanged for
 * P1 — the "Blink form" of storage, spec 03 §4 req 6). MLS group state, private key
 * packages, the ingest/pool state, removal markers and the chat history are key material /
 * plaintext conversations, so nothing is written in the clear:
 *  - a 32-byte store key per ACCOUNT, generated on first use from the CSPRNG and kept in the
 *    keychain (AFTER_FIRST_UNLOCK, same pattern as the nostr nsec) under
 *    `supportchat.storeKey.<accountKey>`;
 *  - values AES-256-GCM encrypted (random 96-bit nonce per write), AAD = the storage key, so a
 *    ciphertext cannot be moved to another key; stored in AsyncStorage.
 * Recorded in findings/M6-demo-apk.md (F-M6-7); the product choice is a PRD security question.
 */
import AsyncStorage from "@react-native-async-storage/async-storage"
import { gcm } from "@noble/ciphers/aes.js"
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils.js"
import { encodeValue, decodeValue } from "@blink-support-chat/adapters/encoding.js"

import {
  readSecretThisDeviceOnly,
  writeSecretThisDeviceOnly,
} from "@app/nostr/core/keystore"
import { secureRandomBytes } from "@app/nostr/core/keygen"
import { supportChatLog } from "./log"

const keyService = (accountKey: string) => `supportchat.storeKey.${accountKey}`
const keyCache = new Map<string, Promise<Uint8Array>>()

/** Hermes C: remove every `supportchat.<accountKey>.*` value (a fresh store key can
 *  never decrypt them — they belong to another device). */
const wipeScopeCiphertext = async (accountKey: string): Promise<number> => {
  const base = `supportchat.${accountKey}.`
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(base))
  if (keys.length) await AsyncStorage.multiRemove(keys)
  return keys.length
}

// M20 (Hermes #3): the store key is this-device-only — a restored iCloud backup then
// holds only ciphertext (history, MLS state, sealed pictures) with no key to open it.
const storeKey = (accountKey: string): Promise<Uint8Array> => {
  let p = keyCache.get(accountKey)
  if (!p) {
    p = (async () => {
      const existing = await readSecretThisDeviceOnly(keyService(accountKey))
      if (existing) return hexToBytes(existing)
      const fresh = secureRandomBytes(32)
      await writeSecretThisDeviceOnly(keyService(accountKey), bytesToHex(fresh))
      // Hermes C: a fresh key means any existing ciphertext belongs to ANOTHER device
      // (restored backup / device migration / a lost keychain) and can never be read
      // — wipe it so the client starts clean instead of throwing on every launch.
      const wiped = await wipeScopeCiphertext(accountKey).catch(() => -1)
      if (wiped > 0)
        supportChatLog(
          `fresh store key: wiped ${wiped} value(s) from another device (clean start)`,
        )
      return fresh
    })()
    p.catch(() => keyCache.delete(accountKey))
    keyCache.set(accountKey, p)
  }
  return p
}

const utf8 = new TextEncoder()
const utf8d = new TextDecoder()

/**
 * M20 (finding 3): the same store key also seals chat PICTURES at rest (AES-256-GCM,
 * random 96-bit nonce per write, AAD binds the ciphertext to its file name). The sealed
 * file layout is `nonce (12 B) ‖ ciphertext`, so pictures are never written in the
 * clear — same rule as the chat history above.
 */
export const sealBytes = async (
  accountKey: string,
  aad: string,
  data: Uint8Array,
): Promise<Uint8Array> => {
  const k = await storeKey(accountKey)
  const n = secureRandomBytes(12)
  const c = gcm(k, n, utf8.encode(aad)).encrypt(data)
  const out = new Uint8Array(n.length + c.length)
  out.set(n, 0)
  out.set(c, n.length)
  return out
}

export const openBytes = async (
  accountKey: string,
  aad: string,
  sealed: Uint8Array,
): Promise<Uint8Array> => {
  const k = await storeKey(accountKey)
  return gcm(k, sealed.slice(0, 12), utf8.encode(aad)).decrypt(sealed.slice(12))
}

export class EncryptedKeyValueStore<T = unknown> {
  private readonly base: string

  constructor(
    private readonly accountKey: string,
    prefix: string,
  ) {
    this.base = `supportchat.${accountKey}.${prefix}`
  }

  async getItem(key: string): Promise<T | null> {
    const raw = await AsyncStorage.getItem(this.base + key)
    if (raw === null) return null
    const { n, c } = JSON.parse(raw) as { n: string; c: string }
    const k = await storeKey(this.accountKey)
    const plain = gcm(k, hexToBytes(n), utf8.encode(this.base + key)).decrypt(
      hexToBytes(c),
    )
    return decodeValue(JSON.parse(utf8d.decode(plain))) as T
  }

  async setItem(key: string, value: T): Promise<T> {
    const k = await storeKey(this.accountKey)
    const n = secureRandomBytes(12)
    const plain = utf8.encode(JSON.stringify(encodeValue(value)))
    const c = gcm(k, n, utf8.encode(this.base + key)).encrypt(plain)
    await AsyncStorage.setItem(
      this.base + key,
      JSON.stringify({ n: bytesToHex(n), c: bytesToHex(c) }),
    )
    return value
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(this.base + key)
  }

  async clear(): Promise<void> {
    const keys = await this.keys()
    await AsyncStorage.multiRemove(keys.map((k) => this.base + k))
  }

  async keys(): Promise<string[]> {
    const all = await AsyncStorage.getAllKeys()
    return all
      .filter((k) => k.startsWith(this.base))
      .map((k) => k.slice(this.base.length))
  }
}
