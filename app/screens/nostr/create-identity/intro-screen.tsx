import React, { useState } from "react"
import { ScrollView, TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"
import type { IdentityKeySource } from "./use-create-identity"

type Props = {
  /** Self-custodial accounts get the seed-derived path as the PRIMARY creation option. */
  canDeriveFromSeed: boolean
  onCreate: (source: IdentityKeySource) => void
  onImport: () => void
}

/** Ceremony step 1 — intro/explainer (Story 1.5 / Task 2). No key is generated here. */
export const NostrCreateIdentityIntroScreen: React.FC<Props> = ({
  canDeriveFromSeed,
  onCreate,
  onImport,
}) => {
  const { LL } = useI18nContext()
  const styles = useStyles()
  const [expanded, setExpanded] = useState(false)
  const T = LL.NostrCreateIdentityScreen

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text type="h1" style={styles.title}>
        {T.introTitle()}
      </Text>
      <Text type="p1" style={styles.body}>
        {T.introBody()}
      </Text>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
      >
        <Text type="p2" style={styles.learnMore}>
          {T.introLearnMore()}
        </Text>
      </TouchableOpacity>
      {expanded ? (
        <Text type="p2" style={styles.body}>
          {T.introLearnMoreBody()}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {canDeriveFromSeed ? (
          <>
            {/* Primary for self-custodial: bind the nostr identity to the wallet seed (NIP-06). */}
            <GaloyPrimaryButton
              title={T.introCreateFromSeed()}
              onPress={() => onCreate("seed")}
              {...testProps("nostr-create-identity-from-seed")}
            />
            <GaloySecondaryButton
              title={T.introCreateRandom()}
              onPress={() => onCreate("random")}
              {...testProps("nostr-create-identity")}
            />
          </>
        ) : (
          <GaloyPrimaryButton
            title={T.introCreate()}
            onPress={() => onCreate("random")}
            {...testProps("nostr-create-identity")}
          />
        )}
        <GaloySecondaryButton
          title={T.introImport()}
          onPress={onImport}
          {...testProps("nostr-import-identity")}
        />
      </View>
    </ScrollView>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  container: { padding: 24, rowGap: 16 },
  title: { color: colors.grey0 },
  body: { color: colors.grey1 },
  learnMore: { color: colors.primary },
  actions: { marginTop: 24, rowGap: 12 },
}))
