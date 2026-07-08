#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
PLATFORM="linux"
ARCH="$(nm_detect_arch)"
CONFIGURATION="Release"
FORMAT="deb"
OUTPUT_DIR=""
PACKAGE_ID="niuma"
VENDOR="NiuMa"
INSTALL_ROOT="/opt/niuma"
SKIP_WEB_BUILD="false"
SKIP_SHELL_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    --format) FORMAT="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --package-id) PACKAGE_ID="$2"; shift 2 ;;
    --vendor) VENDOR="$2"; shift 2 ;;
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
    --skip-web-build) SKIP_WEB_BUILD="true"; shift ;;
    --skip-shell-build) SKIP_SHELL_BUILD="true"; shift ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

nm_require_cmd pnpm
nm_require_cmd node
[[ -n "$OUTPUT_DIR" ]] || OUTPUT_DIR="$(nm_default_output_dir "$REPO_ROOT" "linux" "$ARCH" "$FORMAT")"

VERSION="$(nm_package_json_value "$REPO_ROOT" ".version")"
DESCRIPTION="$(nm_package_json_value "$REPO_ROOT" ".description")"
DEB_ARCH="$(nm_deb_arch "$ARCH")"
SHELL_BIN="$(nm_shell_exe_path "$REPO_ROOT" "$PLATFORM" "$ARCH" "$CONFIGURATION")"
SERVICES_BIN="$(nm_services_bin_dir "$REPO_ROOT" "$PLATFORM" "$ARCH")"
DEB_ROOT="$REPO_ROOT/build/pack-deb"
PAYLOAD_ROOT="$DEB_ROOT$INSTALL_ROOT"
CONTROL_DIR="$DEB_ROOT/DEBIAN"
APP_DIR="$DEB_ROOT/usr/share/applications"
ICON_DIR="$DEB_ROOT/usr/share/icons/hicolor/scalable/apps"
BIN_DIR="$DEB_ROOT/usr/bin"
PACKAGE_BASENAME="${PACKAGE_ID}_${VERSION}_${DEB_ARCH}"

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
rm -rf "$DEB_ROOT" "$OUTPUT_DIR"
mkdir -p "$CONTROL_DIR" "$PAYLOAD_ROOT/resources/web" "$PAYLOAD_ROOT/platform/migrations/sqlite" "$PAYLOAD_ROOT/services/manifests" "$APP_DIR" "$ICON_DIR" "$BIN_DIR" "$OUTPUT_DIR"

cat > "$CONTROL_DIR/control" <<EOF
Package: $PACKAGE_ID
Version: $VERSION
Section: utils
Priority: optional
Architecture: $DEB_ARCH
Maintainer: $VENDOR
Depends: libgtk-3-0, libnss3, libxss1, libasound2, libgbm1, libx11-6, libxcomposite1, libxdamage1, libxrandr2, libatk1.0-0, libcups2
Description: $DESCRIPTION
EOF

cp "$SCRIPT_DIR/templates/postinst" "$CONTROL_DIR/postinst"
cp "$SCRIPT_DIR/templates/prerm" "$CONTROL_DIR/prerm"
chmod 0755 "$CONTROL_DIR/postinst" "$CONTROL_DIR/prerm"

cp -R "$REPO_ROOT/web/dist/." "$PAYLOAD_ROOT/resources/web/" 2>/dev/null || true
cp "$REPO_ROOT"/scripts/sql/sqlite/*.sql "$PAYLOAD_ROOT/platform/migrations/sqlite/" 2>/dev/null || true
cp -R "$REPO_ROOT/services/manifests/." "$PAYLOAD_ROOT/services/manifests/" 2>/dev/null || true
if [[ -d "$REPO_ROOT/plugins" ]]; then
  mkdir -p "$PAYLOAD_ROOT/plugins"
  cp -R "$REPO_ROOT/plugins/." "$PAYLOAD_ROOT/plugins/" 2>/dev/null || true
fi

if [[ -d "$SERVICES_BIN" ]]; then
  mkdir -p "$PAYLOAD_ROOT/services/bin"
  cp -R "$SERVICES_BIN/." "$PAYLOAD_ROOT/services/bin/" 2>/dev/null || true
elif [[ -d "$REPO_ROOT/services/bin" ]]; then
  mkdir -p "$PAYLOAD_ROOT/services/bin"
  cp -R "$REPO_ROOT/services/bin/." "$PAYLOAD_ROOT/services/bin/" 2>/dev/null || true
fi

if [[ -f "$SHELL_BIN" ]]; then
  bash "$REPO_ROOT/scripts/shared/package/stage-cef-runtime.sh" \
    --platform "$PLATFORM" \
    --arch "$ARCH" \
    --dest "$PAYLOAD_ROOT" \
    --source "$SHELL_INSTALL" \
    --configuration "$CONFIGURATION"
  cp "$SHELL_BIN" "$PAYLOAD_ROOT/niuma"
  chmod 0755 "$PAYLOAD_ROOT/niuma"
  if [[ -d "$SHELL_INSTALL/resources/web" ]]; then
    mkdir -p "$PAYLOAD_ROOT/resources"
    cp -R "$SHELL_INSTALL/resources/web" "$PAYLOAD_ROOT/resources/"
  fi
else
  nm_die "shell binary missing at $SHELL_BIN"
fi

cp "$SCRIPT_DIR/templates/niuma.desktop" "$APP_DIR/niuma.desktop"
cp "$REPO_ROOT/assets/brand/app-icon.svg" "$ICON_DIR/niuma.svg"

cat > "$BIN_DIR/niuma" <<EOF
#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$INSTALL_ROOT"
APP_BIN="\$APP_ROOT/niuma"

if [[ ! -x "\$APP_BIN" ]]; then
  echo "NiuMa binary not found: \$APP_BIN" >&2
  echo "Please rebuild shell runtime and reinstall the package." >&2
  exit 1
fi

cd "\$APP_ROOT"
exec "\$APP_BIN" "\$@"
EOF

chmod 0755 "$BIN_DIR/niuma"

bash "$REPO_ROOT/scripts/shared/package/stage-compliance.sh" "$PAYLOAD_ROOT"

mkdir -p "$OUTPUT_DIR/$PACKAGE_BASENAME"
cp -R "$DEB_ROOT/." "$OUTPUT_DIR/$PACKAGE_BASENAME/"

if command -v dpkg-deb >/dev/null 2>&1; then
  DEB_FILE="$OUTPUT_DIR/${PACKAGE_BASENAME}.deb"
  nm_log "build Debian package -> $DEB_FILE"
  dpkg-deb --build "$DEB_ROOT" "$DEB_FILE"
else
  nm_warn "dpkg-deb not found; exported unpacked Debian root to $OUTPUT_DIR/$PACKAGE_BASENAME"
fi

nm_log "Linux packaging done -> $OUTPUT_DIR"
