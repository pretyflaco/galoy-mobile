/**
 * M20 (finding 3): chat pictures are SEALED at rest (AES-GCM, the per-scope store key)
 * in Caches; plaintext shadows exist only for display and are wiped; the one-time
 * migration seals + deletes the plaintext files earlier versions wrote to Documents.
 */
const keychain = new Map<string, string>()
jest.mock("@app/nostr/core/keystore", () => ({
  readSecret: jest.fn(async (service: string) => keychain.get(service) ?? null),
  writeSecret: jest.fn(async (service: string, hex: string) => {
    keychain.set(service, hex)
  }),
}))
let counter = 0
jest.mock("@app/nostr/core/keygen", () => ({
  ...jest.requireActual("@app/nostr/core/keygen"),
  secureRandomBytes: (n: number) => {
    counter += 1
    return Uint8Array.from({ length: n }, (_, i) => (i * 7 + counter) % 251)
  },
}))
jest.mock("react-native-config", () => ({}))
jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

// in-memory RNFS: path → base64 content; "directories" are key prefixes
const files = new Map<string, string>()
jest.mock("react-native-fs", () => ({
  DocumentDirectoryPath: "/mock/documents",
  CachesDirectoryPath: "/mock/caches",
  mkdir: jest.fn(async () => {}),
  writeFile: jest.fn(async (path: string, base64: string) => {
    files.set(path, base64)
  }),
  readFile: jest.fn(async (path: string) => {
    const c = files.get(path)
    if (c === undefined) throw new Error(`no such file: ${path}`)
    return c
  }),
  exists: jest.fn(
    async (path: string) =>
      files.has(path) || [...files.keys()].some((k) => k.startsWith(`${path}/`)),
  ),
  unlink: jest.fn(async (path: string) => {
    if (files.delete(path)) return
    const under = [...files.keys()].filter((k) => k.startsWith(`${path}/`))
    if (!under.length) throw new Error(`no such file: ${path}`)
    under.forEach((k) => files.delete(k))
  }),
  readDir: jest.fn(async (dir: string) => {
    const entries = [...files.keys()].filter(
      (k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes("/"),
    )
    if (!entries.length) throw new Error(`no such dir: ${dir}`)
    return entries.map((p) => ({
      name: p.split("/").pop(),
      path: p,
      isFile: () => true,
    }))
  }),
}))

import {
  ensureLiveImage,
  imageDim,
  imageWithinPixelCap,
  mediaUri,
  migratePlaintextMedia,
  storeSealedImage,
  wipeLiveImages,
} from "@app/support-chat/media"

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8])
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64")
const SCOPE = "device"
const NAME = "ab12.png"
const SEALED = `/mock/caches/support-media/${NAME}.enc`
const LIVE = `/mock/caches/support-media-live/${NAME}`

beforeEach(() => {
  files.clear()
  keychain.clear()
})

describe("M20 sealed picture storage", () => {
  it("seals the canonical copy — the plaintext is nowhere on disk", async () => {
    await storeSealedImage(SCOPE, NAME, PNG)
    const sealedB64 = files.get(SEALED) as string
    expect(sealedB64).toBeTruthy()
    expect(sealedB64).not.toBe(b64(PNG))
    expect(files.get(LIVE)).toBeUndefined()
    // 12-byte nonce ‖ ciphertext, longer than the plaintext
    expect(Buffer.from(sealedB64, "base64").length).toBeGreaterThan(PNG.length)
  })

  it("ensureLiveImage decrypts the shadow for display and is idempotent", async () => {
    await storeSealedImage(SCOPE, NAME, PNG)
    await ensureLiveImage(SCOPE, NAME)
    expect(files.get(LIVE)).toBe(b64(PNG))
    await ensureLiveImage(SCOPE, NAME) // a no-op second call
    expect(files.get(LIVE)).toBe(b64(PNG))
    // a missing sealed copy stays missing (the "not available any more" fallback)
    await ensureLiveImage(SCOPE, "gone.png")
    expect(files.get("/mock/caches/support-media-live/gone.png")).toBeUndefined()
  })

  it("wipeLiveImages deletes every shadow but keeps the sealed copies", async () => {
    await storeSealedImage(SCOPE, NAME, PNG)
    await ensureLiveImage(SCOPE, NAME)
    await wipeLiveImages()
    expect(files.get(LIVE)).toBeUndefined()
    expect(files.get(SEALED)).toBeTruthy()
    // and the shadow can be made again from the sealed copy
    await ensureLiveImage(SCOPE, NAME)
    expect(files.get(LIVE)).toBe(b64(PNG))
  })

  it("the sealed copy cannot be opened under another scope (AAD/key binding)", async () => {
    await storeSealedImage(SCOPE, NAME, PNG)
    await expect(ensureLiveImage("other-scope", NAME)).rejects.toThrow()
  })

  it("migration seals legacy plaintext and deletes the originals", async () => {
    files.set(`/mock/documents/support-media/${NAME}`, b64(PNG))
    files.set("/mock/documents/support-media/cd34.jpg", b64(PNG))
    const moved = await migratePlaintextMedia(SCOPE)
    expect(moved).toBe(2)
    expect(files.get(`/mock/documents/support-media/${NAME}`)).toBeUndefined()
    expect(files.get("/mock/documents/support-media/cd34.jpg")).toBeUndefined()
    expect([...files.keys()].some((k) => k.includes("documents"))).toBe(false) // dir empty/removed
    await ensureLiveImage(SCOPE, NAME) // display works from the migrated sealed copy
    expect(files.get(LIVE)).toBe(b64(PNG))
    expect(await migratePlaintextMedia(SCOPE)).toBe(0) // idempotent
  })

  it("mediaUri resolves by file name against today's live dir", async () => {
    expect(mediaUri("/old/container/support-media/x.jpg")).toBe(
      "file:///mock/caches/support-media-live/x.jpg",
    )
    expect(mediaUri("x.jpg")).toBe("file:///mock/caches/support-media-live/x.jpg")
  })
})

describe("M20 decompression-bomb cap (decoded dimensions from the header)", () => {
  // big-endian byte writers without bitwise operators (the repo lints against them)
  const be32 = (v: number) => [
    Math.floor(v / 16777216) % 256,
    Math.floor(v / 65536) % 256,
    Math.floor(v / 256) % 256,
    v % 256,
  ]
  const be16 = (v: number) => [Math.floor(v / 256) % 256, v % 256]
  const le24 = (v: number) => [
    v % 256,
    Math.floor(v / 256) % 256,
    Math.floor(v / 65536) % 256,
  ]
  const png = (w: number, h: number) => {
    const b = new Uint8Array(33)
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    b.set([0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52], 8) // len + "IHDR"
    b.set(be32(w), 16)
    b.set(be32(h), 20)
    return b
  }
  const jpeg = (w: number, h: number) => {
    const b = new Uint8Array(64)
    b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0) // SOI + APP0 (len 16 → next at 20)
    b.set([0xff, 0xc0, 0x00, 0x11, 8, ...be16(h), ...be16(w)], 20)
    return b
  }
  const webp = (w: number, h: number) => {
    const b = new Uint8Array(31)
    b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]) // RIFF….WEBP
    b.set([0x56, 0x50, 0x38, 0x58], 12) // "VP8X"
    b.set(le24(w - 1), 24)
    b.set(le24(h - 1), 27)
    return b
  }

  it("reads PNG, JPEG and WebP header dimensions", () => {
    expect(imageDim(png(1600, 900))).toEqual({ width: 1600, height: 900 })
    expect(imageDim(jpeg(4000, 3000))).toEqual({ width: 4000, height: 3000 })
    expect(imageDim(webp(800, 600))).toEqual({ width: 800, height: 600 })
  })

  it("accepts ordinary pictures, refuses bombs and unreadable headers", () => {
    expect(imageWithinPixelCap(png(1600, 900))).toBe(true)
    expect(imageWithinPixelCap(jpeg(4000, 3000))).toBe(true) // 12 MP
    expect(imageWithinPixelCap(png(50000, 50000))).toBe(false) // 2.5 Gpx bomb
    expect(imageWithinPixelCap(png(0, 0))).toBe(false)
    expect(imageWithinPixelCap(png(1, 1).slice(0, 12))).toBe(false) // truncated header
  })
})
