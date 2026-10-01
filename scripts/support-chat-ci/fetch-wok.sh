#!/usr/bin/env bash
# Download the pinned wok release for this host (Linux x86-64 / macOS arm64|x86-64)
# and verify its SHA-256 checksum against the release's SHA256SUMS.
set -euo pipefail
VERSION=0.7.0
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) TRIPLE=x86_64-unknown-linux-gnu ;;
  Linux-aarch64) TRIPLE=aarch64-unknown-linux-gnu ;;
  Darwin-arm64) TRIPLE=aarch64-apple-darwin ;;
  Darwin-x86_64) TRIPLE=x86_64-apple-darwin ;;
  *) echo "no wok build for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
ASSET="wok-${VERSION}-${TRIPLE}.tar.gz"
BASE="https://github.com/erskingardner/wok/releases/download/v${VERSION}"
cd "$(dirname "$0")"
mkdir -p bin
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -sfL "$BASE/$ASSET" -o "$tmp/$ASSET"
curl -sfL "$BASE/SHA256SUMS" -o "$tmp/SHA256SUMS"
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
(cd "$tmp" && grep -E " (\./)?$ASSET\$" SHA256SUMS | sed 's# \./# #' | sha256 -c -)
tar -xzf "$tmp/$ASSET" -C "$tmp"
install -m 755 "$(find "$tmp" -type f -name wok | head -1)" bin/wok
bin/wok --version
