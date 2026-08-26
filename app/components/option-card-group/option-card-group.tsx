import React from "react"
import { Pressable, View } from "react-native"

import { makeStyles, Text } from "@rn-vui/themed"

import { testProps } from "@app/utils/testProps"

import { GaloyIcon, IconNamesType } from "../atomic/galoy-icon"

const DEFAULT_ICON_SIZE = 20

export type OptionCard<Key extends string = string> = {
  key: Key
  icon: IconNamesType
  /** Per-card icon render size in px; falls back to the 20px default. */
  iconSize?: number
  title: string
  description: string
  /** Renders the card greyed out and ignores taps — for options that exist but are gated. */
  disabled?: boolean
  /** Small badge over a disabled card explaining why it cannot be picked (e.g. "Not available yet"). */
  disabledBadge?: string
  testID?: string
}

type OptionCardGroupProps<Key extends string> = {
  options: OptionCard<Key>[]
  selectedKey: Key | null
  onSelect: (key: Key) => void
}

/** A row of mutually exclusive cards (icon, title, description); tapping one selects it.
 *  Generic over the key union so callers get their own type back from onSelect. */
export const OptionCardGroup = <Key extends string>({
  options,
  selectedKey,
  onSelect,
}: OptionCardGroupProps<Key>) => {
  const styles = useStyles()

  return (
    <View style={styles.grid}>
      {options.map((option) => {
        const isSelected = selectedKey === option.key
        const cardTestProps = option.testID ? testProps(option.testID) : {}

        return (
          <Pressable
            key={option.key}
            style={[
              styles.card,
              isSelected && styles.cardSelected,
              option.disabled && styles.cardDisabled,
            ]}
            onPress={() => onSelect(option.key)}
            disabled={option.disabled}
            accessibilityState={{ disabled: option.disabled ?? false }}
            {...cardTestProps}
          >
            <View style={styles.iconContainer}>
              <GaloyIcon name={option.icon} size={option.iconSize ?? DEFAULT_ICON_SIZE} />
            </View>
            <Text style={styles.cardTitle}>{option.title}</Text>
            <Text style={styles.cardDescription}>{option.description}</Text>
            {option.disabled && option.disabledBadge ? (
              <Text style={styles.disabledBadge}>{option.disabledBadge}</Text>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

const useStyles = makeStyles(({ colors }) => ({
  grid: {
    flexDirection: "row",
    gap: 10,
  },
  card: {
    flex: 1,
    maxWidth: "50%",
    backgroundColor: colors.grey5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 14,
    paddingVertical: 30,
    alignItems: "center",
    gap: 10,
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.grey6,
  },
  cardDisabled: {
    opacity: 0.45,
  },
  disabledBadge: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    color: colors.grey2,
    textAlign: "center",
  },
  iconContainer: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    color: colors.black,
    textAlign: "center",
  },
  cardDescription: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.grey2,
    textAlign: "center",
  },
}))
