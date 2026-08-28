#!/usr/bin/env bash
# 按从内到外签名 .app，不使用 codesign --deep。
# 环境变量：CODESIGN_IDENTITY、REQUIRE_CODESIGN（1/true 时无证书失败）
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

APP_BUNDLE="${1:-}"
ENTITLEMENTS="${2:-}"
[[ -n "$APP_BUNDLE" && -d "$APP_BUNDLE" ]] || nm_die "usage: codesign-macos.sh <NiuMa.app> [entitlements.plist]"

require_sign() {
  [[ "${REQUIRE_CODESIGN:-}" == "1" || "${REQUIRE_CODESIGN:-}" == "true" ]]
}

if [[ -z "${CODESIGN_IDENTITY:-}" ]]; then
  if require_sign; then
    nm_die "REQUIRE_CODESIGN is set but CODESIGN_IDENTITY is empty"
  fi
  nm_warn "skip codesign (CODESIGN_IDENTITY not set): $APP_BUNDLE"
  exit 0
fi

if [[ -z "$ENTITLEMENTS" ]]; then
  ENTITLEMENTS="$SCRIPT_DIR/../../platforms/macos/pack/niuma.entitlements"
fi
[[ -f "$ENTITLEMENTS" ]] || nm_die "entitlements not found: $ENTITLEMENTS"

sign_bin() {
  local target="$1"
  local with_ent="${2:-}"
  if [[ "$with_ent" == "1" ]]; then
    codesign --force --options runtime --timestamp --sign "$CODESIGN_IDENTITY" \
      --entitlements "$ENTITLEMENTS" "$target"
  else
    codesign --force --options runtime --timestamp --sign "$CODESIGN_IDENTITY" "$target"
  fi
}

# 先签 Framework 内的动态库与 helper，再签 Framework 本体，最后签主程序与 bundle。
while IFS= read -r -d '' item; do
  sign_bin "$item"
done < <(find "$APP_BUNDLE/Contents" \( -name '*.dylib' -o -name '*.so' \) -print0 2>/dev/null || true)

while IFS= read -r -d '' helper; do
  sign_bin "$helper" 1
done < <(find "$APP_BUNDLE/Contents" -name '* Helper.app' -print0 2>/dev/null || true)

FRAMEWORK="$APP_BUNDLE/Contents/Frameworks/Chromium Embedded Framework.framework"
if [[ -d "$FRAMEWORK" ]]; then
  FRAMEWORK_BIN="$FRAMEWORK/Chromium Embedded Framework"
  if [[ -f "$FRAMEWORK_BIN" ]]; then
    sign_bin "$FRAMEWORK_BIN"
  fi
  sign_bin "$FRAMEWORK"
fi

sign_bin "$APP_BUNDLE/Contents/MacOS/niuma" 1
sign_bin "$APP_BUNDLE" 1

codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"
nm_log "codesign verified: $APP_BUNDLE"
