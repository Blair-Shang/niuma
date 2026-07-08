#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
PLATFORM="macos"
ARCH="$(nm_detect_arch)"
APP_NAME="NiuMa"
BUNDLE_ID="com.niuma.desktop"
INPUT_DIR=""
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --app-name) APP_NAME="$2"; shift 2 ;;
    --bundle-id) BUNDLE_ID="$2"; shift 2 ;;
    --input-dir) INPUT_DIR="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

nm_require_cmd pkgbuild
nm_require_cmd productbuild

VERSION="$(nm_package_json_value "$REPO_ROOT" ".version")"
[[ -n "$INPUT_DIR" ]] || INPUT_DIR="$(nm_default_output_dir "$REPO_ROOT" "$PLATFORM" "$ARCH" "app")"
[[ -n "$OUTPUT_DIR" ]] || OUTPUT_DIR="$(nm_default_output_dir "$REPO_ROOT" "$PLATFORM" "$ARCH" "setup")"

APP_BUNDLE="$INPUT_DIR/$APP_NAME.app"
if [[ ! -d "$APP_BUNDLE" ]]; then
  ALT="$(nm_default_output_dir "$REPO_ROOT" "$PLATFORM" "$ARCH" "dmg")/$APP_NAME.app"
  [[ -d "$ALT" ]] && APP_BUNDLE="$ALT"
fi
[[ -d "$APP_BUNDLE" ]] || nm_die "app bundle not found (run: pnpm pack:macos first): $APP_BUNDLE"

WORK_DIR="$REPO_ROOT/build/pack-macos-pkg"
RES_DIR="$WORK_DIR/resources"
PKG_DIR="$WORK_DIR/packages"
rm -rf "$WORK_DIR"
mkdir -p "$RES_DIR" "$PKG_DIR" "$OUTPUT_DIR"

cp -f "$REPO_ROOT/scripts/shared/package/templates/macos-welcome.html" "$RES_DIR/welcome.html"

HOST_ARCHS="x86_64"
if [[ "$ARCH" == "arm64" ]]; then
  HOST_ARCHS="arm64"
else
  HOST_ARCHS="x86_64,arm64"
fi

DIST_XML="$WORK_DIR/Distribution.xml"
cat > "$DIST_XML" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>$APP_NAME</title>
  <welcome file="welcome.html"/>
  <options customize="never" require-scripts="false" hostArchitectures="$HOST_ARCHS"/>
  <choices-outline>
    <line choice="default">
      <line choice="$BUNDLE_ID"/>
    </line>
  </choices-outline>
  <choice id="default"/>
  <choice id="$BUNDLE_ID" visible="false">
    <pkg-ref id="$BUNDLE_ID"/>
  </choice>
  <pkg-ref id="$BUNDLE_ID" version="$VERSION" onConclusion="none">component.pkg</pkg-ref>
</installer-gui-script>
EOF

COMPONENT_PKG="$PKG_DIR/component.pkg"
pkgbuild \
  --component "$APP_BUNDLE" \
  --install-location "/Applications" \
  --identifier "$BUNDLE_ID" \
  --version "$VERSION" \
  "$COMPONENT_PKG"

SETUP_PKG="$OUTPUT_DIR/${APP_NAME}-${VERSION}-${ARCH}-Setup.pkg"
productbuild \
  --distribution "$DIST_XML" \
  --resources "$RES_DIR" \
  --package-path "$PKG_DIR" \
  "$SETUP_PKG"

if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
  nm_log "codesign installer pkg: $CODESIGN_IDENTITY"
  productsign --sign "$CODESIGN_IDENTITY" "$SETUP_PKG" "${SETUP_PKG%.pkg}-signed.pkg"
  mv -f "${SETUP_PKG%.pkg}-signed.pkg" "$SETUP_PKG"
fi

if [[ -n "${NOTARY_APPLE_ID:-}" && -n "${NOTARY_APP_PASSWORD:-}" && -n "${NOTARY_TEAM_ID:-}" ]]; then
  export APPLE_ID="$NOTARY_APPLE_ID"
  export APPLE_APP_PASSWORD="$NOTARY_APP_PASSWORD"
  export APPLE_TEAM_ID="$NOTARY_TEAM_ID"
  bash "$REPO_ROOT/scripts/shared/sign/notarize-macos.sh" "$SETUP_PKG" || nm_warn "notarization failed"
fi

nm_log "macOS GUI installer ready -> $SETUP_PKG"
nm_log "Users can double-click the .pkg to run the installation wizard"
