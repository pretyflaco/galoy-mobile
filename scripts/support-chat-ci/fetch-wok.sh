#!/usr/bin/env bash
# Download the pinned wok release for Linux x86-64 and verify its SHA-256 checksum.
set -euo pipefail
VERSION=0.7.0
ASSET="wok-${VERSION}-x86_64-unknown-linux-gnu.tar.gz"
BASE="https://github.com/erskingardner/wok/releases/download/v${VERSION}"
cd "$(dirname "$0")"
mkdir -p bin
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -sfL "$BASE/$ASSET" -o "$tmp/$ASSET"
curl -sfL "$BASE/SHA256SUMS" -o "$tmp/SHA256SUMS"
(cd "$tmp" && grep -E " (\./)?$ASSET\$" SHA256SUMS | sha256sum -c -)
tar -xzf "$tmp/$ASSET" -C "$tmp"
install -m 755 "$(find "$tmp" -type f -name wok | head -1)" bin/wok
bin/wok --version
