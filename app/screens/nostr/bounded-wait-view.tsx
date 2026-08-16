import React from "react"
import { ActivityIndicator, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import type { BoundedWaitExit, BoundedWaitPhase } from "@app/nostr/transport/bounded-wait"
import { testProps } from "@app/utils/testProps"

type Props = {
  phase: BoundedWaitPhase
  exit: BoundedWaitExit
  canExtend: boolean
  onTryAgain: () => void
  onExit: () => void
  onExtend: () => void
}

/**
 * The single bounded-wait surface (Story 3.1 / AD-11 / NFR-7 / WCAG 2.2.1), rebuilt native
 * in rne-theme from the web/Tailwind blink-terminal reference (no ProgressStepper). Applied
 * identically to connect, session-establishment, and request handling — the phase and exit
 * are driven by the `createBoundedWait` machine. All copy is i18n-sourced.
 *
 * A slow-connection hint appears BEFORE the timeout; the "I need more time" extension is
 * offered while waiting; the timeout terminal offers Try Again + a context exit (Cancel for a
 * general stage, Sign Out for an authenticated session). There is no indefinite spinner: every
 * waiting state has a bounded terminal.
 */
export const BoundedWaitView: React.FC<Props> = ({
  phase,
  exit,
  canExtend,
  onTryAgain,
  onExit,
  onExtend,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const T = LL.NostrBoundedWaitScreen

  if (phase === "timeout") {
    return (
      <View style={styles.container} {...testProps("nostr-bounded-wait-timeout")}>
        <Text type="h2" style={styles.title}>
          {T.timeoutTitle()}
        </Text>
        <Text type="p2" style={styles.body} accessibilityLabel={T.timeoutA11y()}>
          {T.timeoutBody()}
        </Text>
        <GaloyPrimaryButton
          title={T.tryAgain()}
          onPress={onTryAgain}
          {...testProps("nostr-bounded-wait-try-again")}
        />
        <GaloySecondaryButton
          title={exit === "sign-out" ? T.signOut() : T.cancel()}
          onPress={onExit}
          {...testProps("nostr-bounded-wait-exit")}
        />
      </View>
    )
  }

  const isSlow = phase === "slow-connection"

  return (
    <View
      style={styles.container}
      {...testProps(isSlow ? "nostr-bounded-wait-slow" : "nostr-bounded-wait-waiting")}
    >
      <ActivityIndicator size="large" />
      <Text
        type="p2"
        style={styles.body}
        accessibilityLiveRegion="polite"
        accessibilityLabel={isSlow ? T.slowHintA11y() : T.waitingA11y()}
      >
        {isSlow ? T.slowHint() : T.waiting()}
      </Text>
      {canExtend ? (
        <GaloySecondaryButton
          title={T.extend()}
          onPress={onExtend}
          {...testProps("nostr-bounded-wait-extend")}
        />
      ) : null}
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    padding: 24,
    alignItems: "center",
    rowGap: 16,
  },
  title: {
    textAlign: "center",
    color: colors.black,
  },
  body: {
    textAlign: "center",
    color: colors.grey1,
  },
}))
