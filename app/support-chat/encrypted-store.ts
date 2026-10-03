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

import { readSecret, writeSecret } from "@app/nostr/core/keystore"
import { secureRandomBytes } from "@app/nostr/core/keygen"

const keyService = (accountKey: string) => `supportchat.storeKey.${accountKey}`
const keyCache = new Map<string, Promise<Uint8Array>>()

const storeKey = (accountKey: string): Promise<Uint8Array> => {
  let p = keyCache.get(accountKey)
  if (!p) {
    p = (async () => {
      const existing = await readSecret(keyService(accountKey))
      if (existing) return hexToBytes(existing)
      const fresh = secureRandomBytes(32)
      await writeSecret(keyService(accountKey), bytesToHex(fresh))
      return fresh
    })()
    p.catch(() => keyCache.delete(accountKey))
    keyCache.set(accountKey, p)
  }
  return p
}

const utf8 = new TextEncoder()
const utf8d = new TextDecoder()

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
