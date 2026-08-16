/**
 * Signer configuration (AD-11 / AD-13): timeouts, relay defaults, and the single owner
 * of the feature-flag KEY string. Timeouts/relay defaults land with Epic 3; this story
 * establishes the feature-flag key.
 *
 * `SignerEnabledKey` is the ONE owner of the remote-flag key string; the app's remote
 * feature-flag substrate (app/config/feature-flags-context.tsx) references this constant
 * so there is no drift. Default is OFF (see defaultRemoteConfig).
 */
export const SignerEnabledKey = "nostrSignerEnabled" as const
