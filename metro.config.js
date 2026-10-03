// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config")
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path")

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("fs")

const defaultConfig = getDefaultConfig(__dirname)
const { assetExts, sourceExts } = defaultConfig.resolver

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  transformer: {
    babelTransformerPath: require.resolve("react-native-svg-transformer"),
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        // Enable inline requires for improved startup performance
        // This lazy-loads modules only when they're actually used,
        // reducing the initial JavaScript bundle parse time.
        // Expected impact: 0.5-1s faster startup on Android
        // See: https://reactnative.dev/docs/performance#inline-requires
        inlineRequires: true,
      },
    }),
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== "svg"),
    sourceExts: [...sourceExts, "svg", "cjs", "json"],

    // unclear those 2 below are needed
    extraNodeModules: {
      stream: path.resolve(__dirname, "node_modules/readable-stream"),
      zlib: path.resolve(__dirname, "node_modules/browserify-zlib"),
    },

    resolverMainFields: ["sbmodern", "react-native", "browser", "main"],

    // Support chat (from poc/support-chat-demo M6): @hpke/* (ts-mls / marmot-ts HPKE)
    // resolve to their UMD "script" build under the `require` condition; its require()
    // is a factory parameter that Metro cannot see, so the release bundle throws
    // "Requiring unknown module ./src/errors.js" (F-M6-2 — the bundle built fine and
    // the APK failed at the first group creation). Use their ESM build instead.
    resolveRequest: (context, moduleName, platform) => {
      if (/^@hpke\/[^/]+$/.test(moduleName)) {
        const esm = path.resolve(__dirname, "node_modules", moduleName, "esm/mod.js")
        if (fs.existsSync(esm)) return { type: "sourceFile", filePath: esm }
      }
      return context.resolveRequest(context, moduleName, platform)
    },
  },
}

module.exports = mergeConfig(defaultConfig, config)
