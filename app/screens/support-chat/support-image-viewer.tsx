import React, { useState } from "react"
import {
  Image,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from "react-native"
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { CameraRoll } from "@react-native-camera-roll/camera-roll"
import Share from "react-native-share"
import Toast from "react-native-toast-message"
import { Text } from "@rn-vui/themed"

import { GaloyIcon } from "@app/components/atomic/galoy-icon"
import { mediaUri } from "@app/support-chat/media"
import { useI18nContext } from "@app/i18n/i18n-react"

export type ViewerImage = { path: string; width?: number; height?: number }

const MAX_SCALE = 5
const DOUBLE_TAP_SCALE = 2.5

const mimeOf = (path: string) =>
  path.endsWith(".png")
    ? "image/png"
    : path.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg"

/**
 * Full-screen picture from the support chat (M19): pinch to zoom, double-tap to zoom in /
 * out, drag while zoomed; "Save to Photos" (CameraRoll — on Android 10+ no permission, iOS
 * asks once for add-only access) and "Share" (system share sheet). Saving copies the
 * picture out of the chat's private storage into the gallery — only on the user's tap.
 */
export const SupportImageViewer: React.FC<{
  image: ViewerImage | null
  onClose: () => void
}> = ({ image, onClose }) => {
  const { LL } = useI18nContext()
  const T = LL.SupportShareScreen
  const insets = useSafeAreaInsets()
  // inside a (statusBarTranslucent) Modal the top inset can come back as 0 on Android
  const top = Math.max(
    insets.top,
    Platform.OS === "android" ? StatusBar.currentHeight ?? 24 : 0,
  )
  // one save per picture while the viewer is open (repeated taps made duplicates)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)

  const reset = () => {
    "worklet"
    scale.value = withTiming(1)
    savedScale.value = 1
    tx.value = withTiming(0)
    ty.value = withTiming(0)
    savedTx.value = 0
    savedTy.value = 0
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale))
    })
    .onEnd(() => {
      if (scale.value <= 1.01) reset()
      else savedScale.value = scale.value
    })
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (scale.value <= 1) return
      tx.value = savedTx.value + e.translationX
      ty.value = savedTy.value + e.translationY
    })
    .onEnd(() => {
      savedTx.value = tx.value
      savedTy.value = ty.value
    })
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) reset()
      else {
        scale.value = withTiming(DOUBLE_TAP_SCALE)
        savedScale.value = DOUBLE_TAP_SCALE
      }
    })
  const gestures = Gesture.Simultaneous(pinch, pan, doubleTap)

  const animated = useAnimatedStyle(
    () => ({
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { scale: scale.value },
      ],
    }),
    [],
  )

  const close = () => {
    scale.value = 1
    savedScale.value = 1
    tx.value = 0
    ty.value = 0
    savedTx.value = 0
    savedTy.value = 0
    setSavedPath(null)
    onClose()
  }

  const save = async () => {
    if (!image) return
    if (savedPath === image.path) {
      Toast.show({ type: "success", text1: T.viewerSaved(), position: "bottom" })
      return
    }
    try {
      await CameraRoll.saveAsset(mediaUri(image.path), {
        type: "photo",
        album: "Blink Support",
      })
      setSavedPath(image.path)
      Toast.show({ type: "success", text1: T.viewerSaved(), position: "bottom" })
    } catch (e) {
      Toast.show({
        type: "error",
        text1: T.viewerSaveFailed(),
        text2: e instanceof Error ? e.message.slice(0, 80) : undefined,
        position: "bottom",
      })
    }
  }

  const share = () => {
    if (!image) return
    Share.open({
      url: mediaUri(image.path),
      type: mimeOf(image.path),
      failOnCancel: false,
    }).catch(() => undefined)
  }

  return (
    <Modal
      visible={Boolean(image)}
      transparent={false}
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root} testID="support-image-viewer">
        {image && (
          <GestureDetector gesture={gestures}>
            <Animated.View style={[styles.stage, animated]}>
              <Image
                source={{ uri: mediaUri(image.path) }}
                style={styles.image}
                resizeMode="contain"
              />
            </Animated.View>
          </GestureDetector>
        )}
        <Pressable
          onPress={close}
          style={[styles.close, { top: top + 10 }]}
          accessibilityRole="button"
          accessibilityLabel={T.viewerClose()}
          testID="support-image-close"
        >
          <GaloyIcon name="close" size={24} color={VIEWER_WHITE} />
        </Pressable>
        <View style={[styles.actions, { paddingBottom: insets.bottom + 14 }]}>
          <Pressable onPress={save} style={styles.action} testID="support-image-save">
            <GaloyIcon name="download" size={20} color={VIEWER_WHITE} />
            <Text style={styles.actionText}>{T.viewerSave()}</Text>
          </Pressable>
          <Pressable onPress={share} style={styles.action} testID="support-image-share">
            <GaloyIcon name="share" size={20} color={VIEWER_WHITE} />
            <Text style={styles.actionText}>{T.viewerShare()}</Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}

// a photo viewer is black in both themes
const VIEWER_BLACK = "#000000"
const VIEWER_WHITE = "#ffffff"
const OVERLAY = "rgba(0,0,0,0.5)"
const BAR = "rgba(0,0,0,0.6)"
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: VIEWER_BLACK },
  stage: { flex: 1, justifyContent: "center", alignItems: "center" },
  image: { width: "100%", height: "100%" },
  close: {
    position: "absolute",
    left: 14,
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: OVERLAY,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 14,
    backgroundColor: BAR,
  },
  action: { alignItems: "center", gap: 5, paddingHorizontal: 20, paddingVertical: 5 },
  actionText: { fontSize: 14, color: VIEWER_WHITE },
})
