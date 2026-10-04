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
