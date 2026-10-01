/**
 * Default (iOS, tests): no local notification. On iOS the push server sends a visible,
 * content-free APNs alert itself (Transponder payload mode generic_alert); Android's
 * implementation is push-notify.android.ts.
 */
export const showWakeNotification = (): void => undefined

/** iOS: handled with the APNs alert (later); nothing to register here. */
export const onWakeTap = (_onTap: () => void): void => undefined
