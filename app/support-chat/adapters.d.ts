// Loose types for the vendored adapters (plain JS; vendor/blink-support-chat-adapters).
// Deep imports only — the vendor package has no index.js by design (SOURCE.md).
declare module "@blink-support-chat/adapters/*"
// M18: local notifications for the support-chat push wake (the package ships no types).
declare module "react-native-push-notification"
