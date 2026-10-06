import React from "react"
import { StyleSheet, View } from "react-native"

import Svg, { Rect } from "react-native-svg"

import { deriveIdenticon, IDENTICON_SIZE } from "@app/nostr/core/identicon"

type Props = {
  pubkeyHex: string
  size?: number
  accessibilityLabel: string
}

/**
 * Deterministic identicon (Story 1.5 / AC-3). Renders the hash→grid model from
 * `deriveIdenticon` as an SVG using the already-present react-native-svg. The identicon
 * is derived only from the PUBLIC key and carries an accessible name tied to its "your
 * public address" context. Frame is rounded/sm (8px).
 */
export const IdenticonView: React.FC<Props> = ({
  pubkeyHex,
  size = 96,
  accessibilityLabel,
}) => {
  const { cells, color } = deriveIdenticon(pubkeyHex)
  const cell = size / IDENTICON_SIZE

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.frame, { width: size, height: size }]}
    >
      <Svg width={size} height={size}>
        {cells.map((filled, i) =>
          filled ? (
            <Rect
              key={i}
              x={(i % IDENTICON_SIZE) * cell}
              y={Math.floor(i / IDENTICON_SIZE) * cell}
              width={cell}
              height={cell}
              fill={color}
            />
          ) : null,
        )}
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { borderRadius: 8, overflow: "hidden" },
})
