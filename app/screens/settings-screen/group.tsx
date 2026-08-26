import React from "react"
import { View, StyleProp, ViewStyle, TextStyle } from "react-native"

import { makeStyles, useTheme, Text, Divider } from "@rn-vui/themed"

import { DisabledFeature } from "@app/components/disabled-feature"
import { testProps } from "@app/utils/testProps"

type SettingsGroupProps = {
  name?: string
  items: React.FC[]
  containerStyle?: StyleProp<ViewStyle>
  dividerStyle?: StyleProp<ViewStyle>
  titleStyle?: StyleProp<TextStyle>
  disabled?: boolean
  onDisabledPress?: () => void
  /** Rows that ignore the section gate: the group can be disabled while these stay live and
   *  govern themselves (e.g. the Lightning Address row, usable in Incognito on a
   *  --allow-anon-addresses domain). The gate is applied per row rather than once around the
   *  whole list so a single row can opt out. */
  exemptFromDisabled?: React.FC[]
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  name,
  items,
  containerStyle,
  dividerStyle,
  titleStyle,
  disabled = false,
  onDisabledPress,
  exemptFromDisabled = [],
}) => {
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()

  const filteredItems = items.filter((x) => x({}) !== null)

  if (filteredItems.length === 0) return null

  return (
    <View>
      {name && (
        <Text {...testProps(name + "-group")} type="p2" style={titleStyle}>
          {name}
        </Text>
      )}
      <View style={[styles.groupCard, containerStyle]}>
        {filteredItems.map((Element, index) => {
          const hasDividerBelow = index < filteredItems.length - 1
          const itemDisabled = disabled && !exemptFromDisabled.includes(Element)
          return (
            <View key={index}>
              <DisabledFeature
                disabled={itemDisabled}
                onDisabledPress={itemDisabled ? onDisabledPress : undefined}
                accessibilityLabel={name}
              >
                <Element />
              </DisabledFeature>
              {hasDividerBelow && (
                <Divider color={colors.grey4} style={[styles.divider, dividerStyle]} />
              )}
            </View>
          )
        })}
      </View>
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  groupCard: {
    marginTop: 5,
    backgroundColor: colors.grey5,
    borderRadius: 12,
    overflow: "hidden",
  },
  divider: {
    marginHorizontal: 14,
  },
}))
