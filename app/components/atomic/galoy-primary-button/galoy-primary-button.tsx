import React, { FC, PropsWithChildren } from "react"
import { View } from "react-native"

import { testProps } from "@app/utils/testProps"
import { TouchableHighlight } from "@app/utils/touchable-wrapper"
import { Button, ButtonProps, makeStyles, useTheme } from "@rn-vui/themed"

type GaloyPrimaryButtonProps = PropsWithChildren<ButtonProps> & {
  /**
   * Real disabled TREATMENT (visual style + screen-reader state) while keeping the press
   * handler LIVE — for flows where the tap itself must be handled (e.g. tapping Done with
   * a missing prerequisite highlights that prerequisite). Distinct from `disabled`, which
   * swallows the press entirely.
   *
   * Implementation note: RN's Touchable* recompute `accessibilityState.disabled` from the
   * `disabled` prop, so the state cannot be overridden on the button's own touchable.
   * Instead a non-interactive wrapper (`box-none` — taps fall through to the button)
   * carries the accessible disabled announcement and the inner button drops out of the
   * accessibility tree.
   */
  showDisabled?: boolean
}

export const GaloyPrimaryButton: FC<GaloyPrimaryButtonProps> = ({
  showDisabled,
  ...props
}) => {
  const styles = useStyles()
  const {
    theme: { colors },
  } = useTheme()

  const renderButton = (buttonProps: typeof props) => (
    <Button
      {...(typeof buttonProps.title === "string" ? testProps(buttonProps.title) : {})}
      activeOpacity={0.85}
      TouchableComponent={TouchableHighlight}
      // The library hardcodes a white spinner for solid buttons. In dark theme
      // the title on the orange fill is black, so the spinner drifted from the
      // text it stands in for. Track the title's colour instead.
      loadingProps={{ color: colors.white }}
      buttonStyle={[styles.buttonStyle, showDisabled && styles.disabledStyle]}
      titleStyle={[styles.titleStyle, showDisabled && styles.disabledTitleStyle]}
      disabledStyle={styles.disabledStyle}
      disabledTitleStyle={styles.disabledTitleStyle}
      {...buttonProps}
    />
  )

  if (showDisabled) {
    const { testID, accessibilityLabel, ...rest } = props
    return (
      <View
        accessible
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        pointerEvents="box-none"
      >
        {renderButton({ ...rest, accessible: false })}
      </View>
    )
  }

  return renderButton(props)
}

const useStyles = makeStyles(({ colors }) => ({
  titleStyle: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "600",
    color: colors.white,
  },
  disabledTitleStyle: {
    color: colors.grey5,
  },
  buttonStyle: {
    minHeight: 50,
    backgroundColor: colors.primary,
  },
  // Translucent by design: the surface a sticky button sits on is responsible
  // for painting itself, so nothing can show through the button.
  disabledStyle: {
    opacity: 0.5,
    backgroundColor: colors.primary,
  },
}))
