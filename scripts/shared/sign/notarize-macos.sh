#!/usr/bin/env bash
set -euo pipefail
# 可选 macOS 公证（notarytool）。需设置 APPLE_ID、APPLE_TEAM_ID、APPLE_APP_PASSWORD 或 NOTARY_KEYCHAIN_PROFILE。

set +u
PKG_PATH="${1:-}"
set -u

if [[ -z "$PKG_PATH" || ! -f "$PKG_PATH" ]]; then
  echo "usage: notarize-macos.sh <Setup.pkg|NiuMa.app.zip>" >&2
  exit 1
fi

if [[ -z "${APPLE_ID:-}" || -z "${APPLE_TEAM_ID:-}" ]]; then
  echo "WARN: skip notarization (APPLE_ID / APPLE_TEAM_ID not set): $PKG_PATH" >&2
  exit 0
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "missing: xcrun" >&2
  exit 1
fi

SUBMIT_ARGS=(notarytool submit "$PKG_PATH" --team-id "$APPLE_TEAM_ID" --wait)
if [[ -n "${NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
  SUBMIT_ARGS+=(--keychain-profile "$NOTARY_KEYCHAIN_PROFILE")
elif [[ -n "${APPLE_APP_PASSWORD:-}" ]]; then
  SUBMIT_ARGS+=(--apple-id "$APPLE_ID" --password "$APPLE_APP_PASSWORD")
else
  echo "WARN: skip notarization (set NOTARY_KEYCHAIN_PROFILE or APPLE_APP_PASSWORD)" >&2
  exit 0
fi

echo "==> notarytool submit $PKG_PATH"
xcrun "${SUBMIT_ARGS[@]}"

if [[ "$PKG_PATH" == *.pkg || "$PKG_PATH" == *.dmg ]]; then
  echo "==> stapler staple $PKG_PATH"
  xcrun stapler staple "$PKG_PATH"
fi

echo "==> notarization complete"
