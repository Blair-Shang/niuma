#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
PLATFORM="macos"
ARCH="$(nm_detect_arch)"
CONFIGURATION="Release"
FORMAT="dmg"
OUTPUT_DIR=""
APP_NAME="NiuMa"
BUNDLE_ID="com.niuma.desktop"
SKIP_WEB_BUILD="false"
SKIP_SHELL_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    --format) FORMAT="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --app-name) APP_NAME="$2"; shift 2 ;;
    --bundle-id) BUNDLE_ID="$2"; shift 2 ;;
    --skip-web-build) SKIP_WEB_BUILD="true"; shift ;;
    --skip-shell-build) SKIP_SHELL_BUILD="true"; shift ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

nm_require_cmd pnpm
nm_require_cmd node
[[ -n "$OUTPUT_DIR" ]] || OUTPUT_DIR="$(nm_default_output_dir "$REPO_ROOT" "macos" "$ARCH" "$FORMAT")"

VERSION="$(nm_package_json_value "$REPO_ROOT" ".version")"
DESCRIPTION="$(nm_package_json_value "$REPO_ROOT" ".description")"
SHELL_BIN="$(nm_shell_exe_path "$REPO_ROOT" "$PLATFORM" "$ARCH" "$CONFIGURATION")"
SERVICES_BIN="$(nm_services_bin_dir "$REPO_ROOT" "$PLATFORM" "$ARCH")"
APP_BUNDLE="$OUTPUT_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

if [[ "$SKIP_WEB_BUILD" != "true" ]]; then
  nm_log "build web"
  (cd "$REPO_ROOT" && pnpm build:web)
fi

if [[ "$SKIP_SHELL_BUILD" != "true" ]]; then
  bash "$SCRIPT_DIR/../build/build-shell.sh" --platform "$PLATFORM" --arch "$ARCH" --configuration "$CONFIGURATION"
fi

SHELL_BIN="$(nm_shell_exe_path "$REPO_ROOT" "$PLATFORM" "$ARCH" "$CONFIGURATION")"
[[ -f "$SHELL_BIN" ]] || nm_die "shell binary required for packaging: $SHELL_BIN"
SHELL_INSTALL="$(dirname "$SHELL_BIN")"

rm -rf "$OUTPUT_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR/web" "$RESOURCES_DIR/platform/migrations/sqlite" "$RESOURCES_DIR/services/manifests"

cat > "$CONTENTS_DIR/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleExecutable</key>
  <string>niuma</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF

cp -R "$REPO_ROOT/web/dist/." "$RESOURCES_DIR/web/" 2>/dev/null || true
cp "$REPO_ROOT"/scripts/sql/sqlite/*.sql "$RESOURCES_DIR/platform/migrations/sqlite/" 2>/dev/null || true
cp -R "$REPO_ROOT/services/manifests/." "$RESOURCES_DIR/services/manifests/" 2>/dev/null || true
cp "$REPO_ROOT/assets/brand/app-icon.svg" "$RESOURCES_DIR/niuma.svg"

if [[ -d "$REPO_ROOT/plugins" ]]; then
  mkdir -p "$RESOURCES_DIR/plugins"
  cp -R "$REPO_ROOT/plugins/." "$RESOURCES_DIR/plugins/" 2>/dev/null || true
fi

if [[ -d "$SERVICES_BIN" ]]; then
  mkdir -p "$RESOURCES_DIR/services/bin"
  cp -R "$SERVICES_BIN/." "$RESOURCES_DIR/services/bin/" 2>/dev/null || true
elif [[ -d "$REPO_ROOT/services/bin" ]]; then
  mkdir -p "$RESOURCES_DIR/services/bin"
  cp -R "$REPO_ROOT/services/bin/." "$RESOURCES_DIR/services/bin/" 2>/dev/null || true
fi

if [[ -f "$SHELL_BIN" ]]; then
  bash "$REPO_ROOT/scripts/shared/package/stage-cef-runtime.sh" \
    --platform macos \
    --arch "$ARCH" \
    --dest "$MACOS_DIR" \
    --source "$SHELL_INSTALL" \
    --configuration "$CONFIGURATION"
  cp "$SHELL_BIN" "$MACOS_DIR/niuma"
  chmod 0755 "$MACOS_DIR/niuma"
  if [[ -d "$SHELL_INSTALL/resources/web" ]]; then
    cp -R "$SHELL_INSTALL/resources/web/." "$RESOURCES_DIR/web/" 2>/dev/null || true
  fi
else
  nm_die "shell binary missing at $SHELL_BIN"
fi

bash "$REPO_ROOT/scripts/shared/package/stage-compliance.sh" "$RESOURCES_DIR"

nm_log "macOS app bundle assembled -> $APP_BUNDLE"

APP_OUT="$(nm_default_output_dir "$REPO_ROOT" "$PLATFORM" "$ARCH" "app")"
mkdir -p "$APP_OUT"
rm -rf "$APP_OUT/$APP_NAME.app"
cp -R "$APP_BUNDLE" "$APP_OUT/"

if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
  nm_log "codesign app bundle with identity: $CODESIGN_IDENTITY"
  codesign --force --deep --sign "$CODESIGN_IDENTITY" "$APP_BUNDLE"
fi

DMG_FILE=""
if [[ "$FORMAT" == "dmg" ]]; then
  if command -v hdiutil >/dev/null 2>&1; then
    DMG_FILE="$OUTPUT_DIR/${APP_NAME}-${VERSION}-${ARCH}.dmg"
    rm -f "$DMG_FILE"
    nm_log "build dmg -> $DMG_FILE"
    hdiutil create -volname "$APP_NAME" -srcfolder "$APP_BUNDLE" -ov -format UDZO "$DMG_FILE"
  else
    nm_warn "hdiutil not found; kept .app bundle only"
  fi
fi

if [[ -n "${NOTARY_APPLE_ID:-}" && -n "${NOTARY_APP_PASSWORD:-}" && -n "${NOTARY_TEAM_ID:-}" ]]; then
  export APPLE_ID="$NOTARY_APPLE_ID"
  export APPLE_APP_PASSWORD="$NOTARY_APP_PASSWORD"
  export APPLE_TEAM_ID="$NOTARY_TEAM_ID"
  if [[ -n "$DMG_FILE" && -f "$DMG_FILE" ]]; then
    bash "$REPO_ROOT/scripts/shared/sign/notarize-macos.sh" "$DMG_FILE" || nm_warn "notarization failed"
  fi
fi

if [[ -z "${CODESIGN_IDENTITY:-}" ]]; then
  nm_warn "macOS distribution requires codesign/notarization; set CODESIGN_IDENTITY before release"
fi
