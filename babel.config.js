module.exports = {
  presets: ["module:@react-native/babel-preset"],
  plugins: [
    // marmot-ts dist uses `export * as ns from`, which the RN preset does not
    // transform (POC M2 finding; transitive via @babel/preset-env, as in the POC).
    "@babel/plugin-transform-export-namespace-from",
    [
      "react-native-reanimated/plugin",
      {
        globals: ["__scanCodes"],
      },
    ],
    [
      "module-resolver",
      {
        root: ["./app"],
        alias: {
          "^@app/(.+)": "./app/\\1",
        },
      },
    ],
  ],
}
