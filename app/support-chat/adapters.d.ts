// Loose types for the vendored adapters (plain JS; vendor/blink-support-chat-adapters).
// Deep imports only — the vendor package has no index.js by design (SOURCE.md).
declare module "@blink-support-chat/adapters/*"
// TEMP M12 debug (F-M12-2): the debug package ships no types in this tree.
declare module "debug"
