// hermesCryptoProvider — a ts-mls CryptoProvider that is pure JS end to end, for
// the Hermes engine (no WebCrypto anywhere).
//
// Why this exists (findings/M2-phone.md): ts-mls's `nobleCryptoProvider` is NOT
// actually pure JS — its HPKE path builds a CipherSuite from @hpke/core's
// *native* pieces (X25519 KEM, HKDF-SHA256 KDF, AES-128-GCM AEAD all call
// crypto.subtle), and Hermes has no crypto.subtle. The phone hit
// "NotSupportedError: Cannot read property 'generateKey' of undefined" at the
// first HPKE operation (key package creation).
//
// This provider implements ciphersuite 0x0001
// (MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 — the only ciphersuite the
// adopted Marmot spec requires) with:
//   KEM:  @hpke/dhkem-x25519   (noble-based pure JS)
//   KDF:  HKDF-SHA256 over @noble/hashes, implementing @hpke/common KdfInterface
//         (labeled IKM/info framing copied byte-for-byte from HkdfNative)
//   AEAD: AES-128-GCM over @noble/ciphers, implementing @hpke/common AeadInterface
//   sig:  Ed25519 over @noble/curves
// The HPKE framing itself is done by @hpke/core's CipherSuite, unchanged.
// Any other ciphersuite id throws, like the stock providers.
import { hkdf } from "@noble/hashes/hkdf.js"
import { sha256 } from "@noble/hashes/sha256.js"
import { hmac } from "@noble/hashes/hmac.js"
import { gcm } from "@noble/ciphers/aes.js"
import { ed25519 } from "@noble/curves/ed25519.js"
import { randomBytes } from "@noble/hashes/utils.js"
import { CipherSuite } from "@hpke/core"
import { X25519 } from "@hpke/dhkem-x25519"
import { Dhkem, KemId, KdfId, AeadId } from "@hpke/common"
// Fork adaptations (P1/M11) vs the POC source — exactly two import lines:
//   1. sha256 from @noble/hashes/sha256.js, not sha2.js: this vendored file
//      resolves @noble from the fork ROOT (the app's own copies — hashes
//      1.8.0, ciphers 2.2.0, curves 2.0.1; the frozen map in
//      scripts/check-noble-generation.mjs), and sha2.js is a 2.x-only path.
//      Same algorithms, byte-compatible; the ciphersuite impl is opaque to the
//      engine, no noble objects cross the boundary.
//   2. marmot-ts 0.6.0 vendors its ts-mls fork — the npm ts-mls classes are
//      distinct from it (M9 porting list #7), so DependencyError /
//      bytesToArrayBuffer must come from the same vendored fork the engine
//      uses, or instanceof checks inside it would fail.
import { DependencyError, bytesToArrayBuffer } from "@internet-privacy/marmot-ts/mls"

const toU8 = (x) => (x instanceof Uint8Array ? x : new Uint8Array(x instanceof ArrayBuffer ? x : x.buffer ?? x))
const toAB = bytesToArrayBuffer

// ---- @hpke/common KdfInterface over noble (framing mirrors HkdfNative exactly) ----
const HPKE_VERSION = new Uint8Array([72, 80, 75, 69, 45, 118, 49]) // b"HPKE-v1"
class HkdfSha256PureJs {
  id = KdfId.HkdfSha256
  hashSize = 32
  #suiteId = new Uint8Array(0)
  init(suiteId) {
    this.#suiteId = toU8(suiteId)
  }
  buildLabeledIkm(label, ikm) {
    label = toU8(label)
    ikm = toU8(ikm)
    const ret = new Uint8Array(7 + this.#suiteId.length + label.length + ikm.length)
    ret.set(HPKE_VERSION, 0)
    ret.set(this.#suiteId, 7)
    ret.set(label, 7 + this.#suiteId.length)
    ret.set(ikm, 7 + this.#suiteId.length + label.length)
    return ret
  }
  buildLabeledInfo(label, info, len) {
    label = toU8(label)
    info = toU8(info)
    const ret = new Uint8Array(9 + this.#suiteId.length + label.length + info.length)
    ret.set(new Uint8Array([0, len]), 0)
    ret.set(HPKE_VERSION, 2)
    ret.set(this.#suiteId, 9)
    ret.set(label, 9 + this.#suiteId.length)
    ret.set(info, 9 + this.#suiteId.length + label.length)
    return ret
  }
  async extract(salt, ikm) {
    const saltU8 = salt.byteLength === 0 ? new Uint8Array(this.hashSize) : toU8(salt)
    if (saltU8.byteLength !== this.hashSize) throw new Error("salt length must equal hashSize")
    return hmac(sha256, saltU8, toU8(ikm)).buffer
  }
  async expand(prk, info, len) {
    const okm = new Uint8Array(len)
    let prev = new Uint8Array(0)
    const mid = toU8(info)
    for (let i = 1, cur = 0; cur < len; i++) {
      const input = new Uint8Array(prev.length + mid.length + 1)
      input.set(prev, 0)
      input.set(mid, prev.length)
      input[prev.length + mid.length] = i
      prev = hmac(sha256, toU8(prk), input)
      okm.set(prev.subarray(0, Math.min(prev.length, len - cur)), cur)
      cur += prev.length
    }
    return okm.buffer
  }
  async extractAndExpand(salt, ikm, info, len) {
    const saltU8 = salt.byteLength === 0 ? new Uint8Array(this.hashSize) : toU8(salt)
    return hkdf(sha256, toU8(ikm), saltU8, toU8(info), len).buffer
  }
  async labeledExtract(salt, label, ikm) {
    return this.extract(salt, this.buildLabeledIkm(label, ikm))
  }
  async labeledExpand(prk, label, info, len) {
    return this.expand(prk, this.buildLabeledInfo(label, info, len), len)
  }
}

// ---- @hpke/common AeadInterface over noble AES-128-GCM ----
class Aes128GcmPureJs {
  id = AeadId.Aes128Gcm
  keySize = 16
  nonceSize = 12
  tagSize = 16
  createEncryptionContext(key) {
    const keyU8 = toU8(key)
    return {
      seal: async (iv, data, aad) => gcm(keyU8, toU8(iv), toU8(aad)).encrypt(toU8(data)).buffer,
      open: async (iv, data, aad) => gcm(keyU8, toU8(iv), toU8(aad)).decrypt(toU8(data)).buffer,
    }
  }
}

// noble AES-GCM helpers for the ts-mls-level encryptAead/decryptAead
const encryptAesGcm = (key, nonce, aad, pt) => gcm(toU8(key), toU8(nonce), aad ? toU8(aad) : new Uint8Array()).encrypt(toU8(pt))
const decryptAesGcm = (key, nonce, aad, ct) => gcm(toU8(key), toU8(nonce), aad ? toU8(aad) : new Uint8Array()).decrypt(toU8(ct))

const constantTimeEqual = (a, b) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// ts-mls convention: Ed25519 signature private keys are PKCS#8 (48 bytes), not raw
// 32-byte seeds (stock makeNobleSignatureImpl does the same wrapping for WebCrypto).
// Copied from ts-mls makeNobleSignatureImpl.js.
function rawEd25519ToPKCS8(rawKey) {
  const oid = new Uint8Array([0x06, 0x03, 0x2b, 0x65, 0x70])
  const innerOctetString = new Uint8Array([0x04, 0x20, ...rawKey])
  const privateKeyField = new Uint8Array([0x04, 0x22, ...innerOctetString])
  const algorithmSeq = new Uint8Array([0x30, 0x05, ...oid])
  const version = new Uint8Array([0x02, 0x01, 0x00])
  const content = new Uint8Array([...version, ...algorithmSeq, ...privateKeyField])
  return new Uint8Array([0x30, content.length, ...content])
}
const ed25519Seed = (signKey) => (signKey.length === 32 ? signKey : signKey.slice(-32))

async function makeHermesCiphersuiteImpl() {
  // The KEM is assembled from parts: @hpke/dhkem-x25519's ready-made
  // DhkemX25519HkdfSha256 wires in a KDF that extends HkdfSha256Native (WebCrypto) —
  // its extract() calls crypto.subtle for hash-length salts and crashes on Hermes
  // (DecapError "importKey of undefined"). The X25519 primitive itself is pure JS,
  // so we wire it to our pure-JS KDF exactly like DhkemX25519HkdfSha256 does.
  const kemKdf = new HkdfSha256PureJs()
  const kem = new Dhkem(KemId.DhkemX25519HkdfSha256, new X25519(kemKdf), kemKdf)
  // The Dhkem base defaults all sizes to 0 — the ready-made subclass sets them.
  // With secretSize=0 the shared secret is empty and every HPKE open fails GCM
  // (self-consistent, so round trips pass; cross-provider opens fail).
  kem.secretSize = 32
  kem.encSize = 32
  kem.publicKeySize = 32
  kem.privateKeySize = 32
  const cs = new CipherSuite({
    kem,
    kdf: new HkdfSha256PureJs(),
    aead: new Aes128GcmPureJs(),
  })
  return {
    id: 1,
    // HKDF-SHA256 at the ts-mls level (raw extract/expand, matching makeKdfImpl)
    kdf: {
      async extract(salt, ikm) {
        const saltU8 = salt.byteLength === 0 ? new Uint8Array(32) : toU8(salt)
        return hmac(sha256, saltU8, toU8(ikm))
      },
      async expand(prk, info, len) {
        const okm = new Uint8Array(len)
        let prev = new Uint8Array(0)
        const mid = toU8(info)
        for (let i = 1, cur = 0; cur < len; i++) {
          const input = new Uint8Array(prev.length + mid.length + 1)
          input.set(prev, 0)
          input.set(mid, prev.length)
          input[prev.length + mid.length] = i
          prev = hmac(sha256, toU8(prk), input)
          okm.set(prev.subarray(0, Math.min(prev.length, len - cur)), cur)
          cur += prev.length
        }
        return okm
      },
      size: 32,
    },
    // SHA-256 / HMAC-SHA256
    hash: {
      async digest(data) {
        return sha256(toU8(data))
      },
      async mac(key, data) {
        return hmac(sha256, toU8(key), toU8(data))
      },
      async verifyMac(key, mac, data) {
        return constantTimeEqual(toU8(mac), hmac(sha256, toU8(key), toU8(data)))
      },
    },
    // Ed25519 (private keys are PKCS#8, per the ts-mls convention above)
    signature: {
      async sign(signKey, message) {
        return ed25519.sign(toU8(message), ed25519Seed(toU8(signKey)))
      },
      async verify(publicKey, message, signature) {
        return ed25519.verify(toU8(signature), toU8(message), toU8(publicKey))
      },
      async keygen() {
        const seed = ed25519.utils.randomSecretKey()
        return { signKey: rawEd25519ToPKCS8(seed), publicKey: ed25519.getPublicKey(seed) }
      },
    },
    // HPKE — same surface as ts-mls's makeGenericHpke (crypto/implementation/hpke.js).
    // Keys may arrive as raw bytes OR as key objects (ts-mls's join path passes the
    // result of importPrivateKey straight into hpke.open) — accept both. The pure-JS
    // KEM requires key objects internally, so raw bytes are deserialized first (the
    // native KEM does this transparently, which is why stock makeGenericHpke can
    // always pass values through unchanged).
    hpke: (() => {
      const asPriv = async (k) =>
        k instanceof Uint8Array || k instanceof ArrayBuffer ? cs.kem.deserializePrivateKey(toAB(k)) : k
      const asPub = async (k) =>
        k instanceof Uint8Array || k instanceof ArrayBuffer ? cs.kem.deserializePublicKey(toAB(k)) : k
      return {
      async open(privateKey, kemOutput, ciphertext, info, aad) {
        const result = await cs.open(
          { recipientKey: await asPriv(privateKey), enc: toAB(kemOutput), info: toAB(info) },
          toAB(ciphertext),
          aad ? toAB(aad) : new ArrayBuffer(),
        )
        return new Uint8Array(result)
      },
      async seal(publicKey, plaintext, info, aad) {
        const result = await cs.seal(
          { recipientPublicKey: await asPub(publicKey), info: toAB(info) },
          toAB(plaintext),
          aad ? toAB(aad) : new ArrayBuffer(),
        )
        return { ct: new Uint8Array(result.ct), enc: new Uint8Array(result.enc) }
      },
      async exportSecret(publicKey, exporterContext, length, info) {
        const context = await cs.createSenderContext({
          recipientPublicKey: await asPub(publicKey),
          info: toAB(info),
        })
        return {
          enc: new Uint8Array(context.enc),
          secret: new Uint8Array(await context.export(toAB(exporterContext), length)),
        }
      },
      async importSecret(privateKey, exporterContext, kemOutput, length, info) {
        const context = await cs.createRecipientContext({
          recipientKey: await asPriv(privateKey),
          info: toAB(info),
          enc: toAB(kemOutput),
        })
        return new Uint8Array(await context.export(toAB(exporterContext), length))
      },
      async importPrivateKey(k) {
        return cs.kem.deserializePrivateKey(toAB(k))
      },
      async importPublicKey(k) {
        return cs.kem.deserializePublicKey(toAB(k))
      },
      async exportPublicKey(k) {
        return new Uint8Array(await cs.kem.serializePublicKey(k))
      },
      async exportPrivateKey(k) {
        return new Uint8Array(await cs.kem.serializePrivateKey(k))
      },
      async encryptAead(key, nonce, aad, plaintext) {
        return encryptAesGcm(key, nonce, aad, plaintext)
      },
      async decryptAead(key, nonce, aad, ciphertext) {
        return decryptAesGcm(key, nonce, aad, ciphertext)
      },
      async deriveKeyPair(ikm) {
        const kp = await cs.kem.deriveKeyPair(toAB(ikm))
        return { privateKey: kp.privateKey, publicKey: kp.publicKey }
      },
      async generateKeyPair() {
        const kp = await cs.kem.generateKeyPair()
        return { privateKey: kp.privateKey, publicKey: kp.publicKey }
      },
      keyLength: 16,
      nonceLength: 12,
      }
    })(),
    rng: { randomBytes },
  }
}

/** ts-mls CryptoProvider for Hermes: pure JS, ciphersuite 0x0001 only. */
export const hermesCryptoProvider = {
  async getCiphersuiteImpl(id) {
    if (id !== 1) throw new DependencyError(`hermesCryptoProvider supports only ciphersuite 0x0001, got: ${id}`)
    return makeHermesCiphersuiteImpl()
  },
}
