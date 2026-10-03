#!/usr/bin/env bash
# Build "Blink Alpha DEV" for a real iPhone with a FREE personal team (M19 device test).
#
#   TEAM_ID=<10-char personal team id> scripts/support-chat-alpha/ios-dev-device.sh [--install <device-udid>]
#   (<device-udid> = the HARDWARE udid, e.g. 00008101-…: `xcrun xctrace list devices`)
#
# Run on the Mac, inside `nix develop` (Xcode 26.5 selected), after `yarn install`.
# The Apple ID must be signed in once in Xcode → Settings → Accounts (creates the team).
#
# What it does, and why it is a script and not a committed build configuration:
#   - bundle id com.blinkbtc.alpha.DEV — never com.blinkbtc.alpha, which belongs to the Blink
#     Apple team (blink-wip#1500); display name "Blink Alpha";
#   - minimal entitlements (GaloyAppAlphaDev.entitlements): a free team cannot sign push,
#     associated domains, iCloud or NFC;
#   - automatic signing with TEAM_ID, -allowProvisioningUpdates;
#   - the CI-only synthetic Firebase plist (no real Firebase project; push is off anyway);
#   - .env.alpha minus SUPPORT_PUSH_SERVER_PUBKEY (no APNs on a free team);
#   - the JS bundle is embedded (FORCE_BUNDLING=1): the phone needs no Metro.
# The project files it patches (pbxproj, Info.plist, GoogleService-Info.plist) are restored
# on exit, so nothing signing-related is ever committed. Free-team installs expire after 7 days.
set -euo pipefail

[ "$(uname)" = "Darwin" ] || { echo "macOS only" >&2; exit 1; }
[ -n "${TEAM_ID:-}" ] || { echo "set TEAM_ID (Xcode → Settings → Accounts → your personal team)" >&2; exit 2; }
[[ "$TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || { echo "TEAM_ID must be 10 characters A-Z0-9" >&2; exit 2; }
[ "$TEAM_ID" != "UL7ND37VAD" ] || { echo "that is the Blink team — use your personal team" >&2; exit 2; }
command -v xcodebuild >/dev/null || { echo "run inside nix develop (no xcodebuild)" >&2; exit 1; }
[ -f .env.alpha ] || { echo ".env.alpha missing (copy it from muscle, mode 600)" >&2; exit 1; }

INSTALL_UDID=""
[ "${1:-}" = "--install" ] && INSTALL_UDID="${2:?--install needs the hardware UDID of the device (xcrun xctrace list devices)}"
# A free team gets a provisioning profile only for devices registered with it, and Xcode
# registers the plugged-in device only when the build TARGETS it (F-M19-6) — a generic
# destination fails with "Your team has no devices from which to generate a provisioning profile".
DESTINATION="generic/platform=iOS"
[ -n "$INSTALL_UDID" ] && DESTINATION="id=$INSTALL_UDID"

BUNDLE_ID="com.blinkbtc.alpha.dev"
PBX=ios/GaloyApp.xcodeproj/project.pbxproj
PLIST=ios/GaloyApp/Info.plist
FIREBASE=ios/GoogleService-Info.plist

restore() { git checkout -- "$PBX" "$PLIST" "$FIREBASE" 2>/dev/null || true; rm -f .env.alpha-ios; }
trap restore EXIT

# env: push off (no APNs on a free team)
grep -v '^SUPPORT_PUSH_SERVER_PUBKEY=' .env.alpha > .env.alpha-ios
chmod 600 .env.alpha-ios

# the app target's build settings only (the Pods project is not touched)
sed -i '' \
  -e "s/PRODUCT_BUNDLE_IDENTIFIER = io.galoy.bitcoinbeach;/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID;/" \
  -e "s/DEVELOPMENT_TEAM = UL7ND37VAD;/DEVELOPMENT_TEAM = $TEAM_ID;/" \
  -e "s/\"DEVELOPMENT_TEAM\[sdk=iphoneos\*\]\" = UL7ND37VAD;/\"DEVELOPMENT_TEAM[sdk=iphoneos*]\" = $TEAM_ID;/" \
  -e "s/CODE_SIGN_STYLE = Manual;/CODE_SIGN_STYLE = Automatic;/" \
  -e "s#CODE_SIGN_ENTITLEMENTS = GaloyApp/GaloyApp\(Debug\)\{0,1\}.entitlements;#CODE_SIGN_ENTITLEMENTS = GaloyApp/GaloyAppAlphaDev.entitlements;#" \
  -e "/PROVISIONING_PROFILE_SPECIFIER/d" \
  "$PBX"
grep -q "PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID;" "$PBX" || { echo "pbxproj patch failed (bundle id)" >&2; exit 1; }
grep -q "GaloyAppAlphaDev.entitlements" "$PBX" || { echo "pbxproj patch failed (entitlements)" >&2; exit 1; }
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Blink Alpha" "$PLIST"
cp scripts/support-chat-ci/GoogleService-Info.ci.plist "$FIREBASE"

mkdir -p smoke-artifacts
echo "==> building $BUNDLE_ID for $DESTINATION (team $TEAM_ID)"
ENVFILE=.env.alpha-ios FORCE_BUNDLING=1 RCT_NO_LAUNCH_PACKAGER=1 \
  xcodebuild -workspace ios/GaloyApp.xcworkspace -scheme GaloyApp -configuration Debug \
    -destination "$DESTINATION" -derivedDataPath ios/build-dev \
    -allowProvisioningUpdates build > smoke-artifacts/ios-dev-build.log 2>&1 \
  || { grep -nE "error:|BUILD FAILED" smoke-artifacts/ios-dev-build.log | head -40; tail -40 smoke-artifacts/ios-dev-build.log; exit 1; }
APP=ios/build-dev/Build/Products/Debug-iphoneos/Blink.app
ls -la "$APP/main.jsbundle"
codesign -dv "$APP" 2>&1 | grep -E "Identifier|TeamIdentifier"
echo "built: $APP"

if [ -n "$INSTALL_UDID" ]; then
  xcrun devicectl device install app --device "$INSTALL_UDID" "$APP"
  echo "installed on $INSTALL_UDID — on the iPhone: Settings → General → VPN & Device Management → trust the developer"
fi
