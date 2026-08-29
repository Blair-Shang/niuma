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

nm_emit_build_info "$REPO_ROOT"
VERSION="$(nm_build_info_value "$REPO_ROOT" ".version")"
BUILD_NUMBER="$(nm_build_info_value "$REPO_ROOT" ".buildNumber")"
CHANNEL="$(nm_build_info_value "$REPO_ROOT" ".channel")"
HOMEPAGE="$(nm_build_info_value "$REPO_ROOT" ".homepage")"
PUBLISHER="$(nm_build_info_value "$REPO_ROOT" ".publisher")"
DESCRIPTION="$(nm_package_json_value "$REPO_ROOT" ".description")"
[[ -n "$BUILD_NUMBER" ]] || BUILD_NUMBER="0"
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
  <string>$BUILD_NUMBER</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>NSHumanReadableCopyright</key>
  <string>Copyright (C) $PUBLISHER</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>$BUNDLE_ID</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>niuma</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
EOF
bash "$SCRIPT_DIR/generate-icns.sh" "$RESOURCES_DIR/AppIcon.icns" || true
if [[ ! -f "$RESOURCES_DIR/AppIcon.icns" ]]; then
  nm_warn "AppIcon.icns missing; Finder will show a generic icon"
fi

cp -R "$REPO_ROOT/web/dist/." "$RESOURCES_DIR/web/" 2>/dev/null || true
find "$RESOURCES_DIR/web" -type f -name '*.map' -delete 2>/dev/null || true
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
else
  nm_die "services matrix bin missing at $SERVICES_BIN — build services for $PLATFORM/$ARCH first (do not fall back to flat services/bin)"
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
  if [[ ! -f "$RESOURCES_DIR/web/index.html" && -d "$SHELL_INSTALL/resources/web" ]]; then
    cp -R "$SHELL_INSTALL/resources/web/." "$RESOURCES_DIR/web/" 2>/dev/null || true
    find "$RESOURCES_DIR/web" -type f -name '*.map' -delete 2>/dev/null || true
  fi
else
  nm_die "shell binary missing at $SHELL_BIN"
fi

# CEF 从 M76 起必须在 Contents/Frameworks 下放 Helper 子进程包，否则渲染/GPU 起不来。
FRAMEWORKS_DIR="$CONTENTS_DIR/Frameworks"
mkdir -p "$FRAMEWORKS_DIR"
write_helper_plist() {
  local helper_name="$1"
  local helper_id="$2"
  local plist="$3"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>$helper_name</string>
  <key>CFBundleExecutable</key>
  <string>$helper_name</string>
  <key>CFBundleIdentifier</key>
  <string>$helper_id</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$helper_name</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$BUILD_NUMBER</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST
}

HELPER_SPECS=(
  "NiuMa Helper|$BUNDLE_ID.helper"
  "NiuMa Helper (GPU)|$BUNDLE_ID.helper.gpu"
  "NiuMa Helper (Plugin)|$BUNDLE_ID.helper.plugin"
  "NiuMa Helper (Renderer)|$BUNDLE_ID.helper.renderer"
  "NiuMa Helper (Alerts)|$BUNDLE_ID.helper.alerts"
)
for spec in "${HELPER_SPECS[@]}"; do
  helper_name="${spec%%|*}"
  helper_id="${spec#*|}"
  helper_app="$FRAMEWORKS_DIR/${helper_name}.app"
  mkdir -p "$helper_app/Contents/MacOS"
  cp "$MACOS_DIR/niuma" "$helper_app/Contents/MacOS/${helper_name}"
  chmod 0755 "$helper_app/Contents/MacOS/${helper_name}"
  write_helper_plist "$helper_name" "$helper_id" "$helper_app/Contents/Info.plist"
done
[[ -d "$FRAMEWORKS_DIR/NiuMa Helper.app" ]] || nm_die "macOS CEF helper apps were not staged"
[[ -d "$FRAMEWORKS_DIR/Chromium Embedded Framework.framework" ]] || nm_die "macOS CEF framework missing under Frameworks"

bash "$REPO_ROOT/scripts/shared/package/stage-compliance.sh" "$RESOURCES_DIR"

nm_log "macOS app bundle assembled -> $APP_BUNDLE ($VERSION channel=$CHANNEL build=$BUILD_NUMBER $HOMEPAGE)"

bash "$REPO_ROOT/scripts/shared/sign/codesign-macos.sh" "$APP_BUNDLE" \
  "$SCRIPT_DIR/niuma.entitlements"

APP_OUT="$(nm_default_output_dir "$REPO_ROOT" "$PLATFORM" "$ARCH" "app")"
mkdir -p "$APP_OUT"
rm -rf "$APP_OUT/$APP_NAME.app"
cp -R "$APP_BUNDLE" "$APP_OUT/"

DMG_FILE=""
if [[ "$FORMAT" == "dmg" ]]; then
  if command -v hdiutil >/dev/null 2>&1; then
    DMG_FILE="$OUTPUT_DIR/${APP_NAME}-${VERSION}-macos-${ARCH}.dmg"
    rm -f "$DMG_FILE"
    nm_log "build dmg -> $DMG_FILE"
    hdiutil create -volname "$APP_NAME" -srcfolder "$APP_BUNDLE" -ov -format UDZO "$DMG_FILE"
    if [[ -n "${CODESIGN_IDENTITY:-}" && -f "$DMG_FILE" ]]; then
      codesign --force --timestamp --sign "$CODESIGN_IDENTITY" "$DMG_FILE"
    fi
  else
    nm_warn "hdiutil not found; kept .app bundle only"
  fi
fi

if [[ -n "${NOTARY_APPLE_ID:-}" && -n "${NOTARY_APP_PASSWORD:-}" && -n "${NOTARY_TEAM_ID:-}" ]]; then
  export APPLE_ID="$NOTARY_APPLE_ID"
  export APPLE_APP_PASSWORD="$NOTARY_APP_PASSWORD"
  export APPLE_TEAM_ID="$NOTARY_TEAM_ID"
  if [[ -n "$DMG_FILE" && -f "$DMG_FILE" ]]; then
    bash "$REPO_ROOT/scripts/shared/sign/notarize-macos.sh" "$DMG_FILE" || {
      if [[ "${REQUIRE_CODESIGN:-}" == "1" || "${REQUIRE_CODESIGN:-}" == "true" ]]; then
        nm_die "notarization failed"
      fi
      nm_warn "notarization failed"
    }
  fi
elif [[ "${REQUIRE_CODESIGN:-}" == "1" || "${REQUIRE_CODESIGN:-}" == "true" ]]; then
  nm_die "REQUIRE_CODESIGN is set but NOTARY_APPLE_ID / NOTARY_TEAM_ID are empty"
fi

if [[ -z "${CODESIGN_IDENTITY:-}" ]]; then
  nm_warn "macOS distribution requires codesign/notarization; set CODESIGN_IDENTITY before release"
fi
