import React, { useState } from "react"
import { ScrollView, TouchableOpacity, View } from "react-native"

import { Text, makeStyles } from "@rn-vui/themed"

import { GaloyPrimaryButton } from "@app/components/atomic/galoy-primary-button"
import { GaloySecondaryButton } from "@app/components/atomic/galoy-secondary-button"
import { useI18nContext } from "@app/i18n/i18n-react"
import { testProps } from "@app/utils/testProps"

type Props = {
  onCreate: () => void
  onImport: () => void
}

/** Ceremony step 1 — intro/explainer (Story 1.5 / Task 2). No key is generated here. */
export const NostrCreateIdentityIntroScreen: React.FC<Props> = ({
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
        <GaloyPrimaryButton
          title={T.introCreate()}
          onPress={onCreate}
          {...testProps("nostr-create-identity")}
        />
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
