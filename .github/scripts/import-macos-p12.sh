#!/usr/bin/env bash
# Import Developer ID P12 into a temporary keychain for codesign / productsign.
# Secrets: MACOS_P12_BASE64, MACOS_P12_PASSWORD, optional MACOS_KEYCHAIN_PASSWORD.
set -euo pipefail

if [[ -z "${MACOS_P12_BASE64:-}" ]]; then
  echo "==> skip macOS codesign import (MACOS_P12_BASE64 not set)"
  exit 0
fi

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
P12="$RUNNER_TEMP/niuma-codesign.p12"
KEYCHAIN="$RUNNER_TEMP/niuma-signing.keychain-db"
PASS="${MACOS_KEYCHAIN_PASSWORD:-$(openssl rand -base64 24)}"

echo "$MACOS_P12_BASE64" | base64 --decode > "$P12"
rm -f "$KEYCHAIN"

security create-keychain -p "$PASS" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$PASS" "$KEYCHAIN"
security import "$P12" -k "$KEYCHAIN" -P "${MACOS_P12_PASSWORD:-}" \
  -T /usr/bin/codesign -T /usr/bin/productsign -T /usr/bin/security
rm -f "$P12"

EXISTING="$(security list-keychain -d user | tr -d '"')"
# shellcheck disable=SC2086
security list-keychain -d user -s "$KEYCHAIN" $EXISTING
security set-key-partition-list -S apple-tool:,apple: -s -k "$PASS" "$KEYCHAIN" >/dev/null
echo "==> imported macOS signing certificate into $KEYCHAIN"
