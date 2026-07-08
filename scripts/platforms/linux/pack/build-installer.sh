#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
PLATFORM="linux"
ARCH="$(nm_detect_arch)"
INPUT_DIR=""
OUTPUT_DIR=""
PACKAGE_ID="niuma"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --input-dir) INPUT_DIR="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --package-id) PACKAGE_ID="$2"; shift 2 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

if [[ "$PLATFORM" == "kylin" ]]; then
  PACKAGE_ID="niuma-kylin"
fi

VERSION="$(nm_package_json_value "$REPO_ROOT" ".version")"
DEB_ARCH="$(nm_deb_arch "$ARCH")"
[[ -n "$INPUT_DIR" ]] || INPUT_DIR="$(nm_default_output_dir "$REPO_ROOT" "$PLATFORM" "$ARCH" "deb")"
[[ -n "$OUTPUT_DIR" ]] || OUTPUT_DIR="$(nm_default_output_dir "$REPO_ROOT" "$PLATFORM" "$ARCH" "setup")"

DEB_GLOB="${PACKAGE_ID}_${VERSION}_${DEB_ARCH}.deb"
DEB_FILE="$INPUT_DIR/$DEB_GLOB"
if [[ ! -f "$DEB_FILE" ]]; then
  DEB_FILE="$(find "$INPUT_DIR" -maxdepth 1 -name '*.deb' -type f | head -n 1)"
fi
[[ -f "$DEB_FILE" ]] || nm_die "deb package not found under $INPUT_DIR (run: pnpm pack:$PLATFORM first)"

ARCH_LABEL="$ARCH"
SETUP_NAME="NiuMa-${VERSION}-${ARCH_LABEL}-Setup.run"
PAYLOAD_DIR="$REPO_ROOT/build/pack-linux-setup-payload"
rm -rf "$PAYLOAD_DIR"
mkdir -p "$PAYLOAD_DIR"
cp -f "$DEB_FILE" "$PAYLOAD_DIR/package.deb"
cp -f "$REPO_ROOT/scripts/shared/package/templates/linux-install-wizard.sh" "$PAYLOAD_DIR/install.sh"
chmod +x "$PAYLOAD_DIR/install.sh"

mkdir -p "$OUTPUT_DIR"
OUTPUT_RUN="$OUTPUT_DIR/$SETUP_NAME"
bash "$REPO_ROOT/scripts/shared/package/make-self-extracting-run.sh" \
  "$PAYLOAD_DIR" \
  "$OUTPUT_RUN" \
  "NiuMa" \
  "$VERSION"

UNINSTALL_PAYLOAD="$REPO_ROOT/build/pack-linux-uninstall-payload"
rm -rf "$UNINSTALL_PAYLOAD"
mkdir -p "$UNINSTALL_PAYLOAD"
cp -f "$REPO_ROOT/scripts/shared/package/templates/linux-uninstall-wizard.sh" "$UNINSTALL_PAYLOAD/uninstall.sh"
sed -i "s/__PACKAGE_ID__/$PACKAGE_ID/g" "$UNINSTALL_PAYLOAD/uninstall.sh" 2>/dev/null || \
  sed -i '' "s/__PACKAGE_ID__/$PACKAGE_ID/g" "$UNINSTALL_PAYLOAD/uninstall.sh"
chmod +x "$UNINSTALL_PAYLOAD/uninstall.sh"
UNINSTALL_RUN="$OUTPUT_DIR/NiuMa-${VERSION}-${ARCH_LABEL}-Uninstall.run"
bash "$REPO_ROOT/scripts/shared/package/make-self-extracting-run.sh" \
  "$UNINSTALL_PAYLOAD" \
  "$UNINSTALL_RUN" \
  "NiuMa" \
  "$VERSION" \
  "uninstall.sh"

nm_log "Linux GUI installer ready -> $OUTPUT_RUN"
nm_log "Linux GUI uninstaller ready -> $UNINSTALL_RUN"
nm_log "Users can run: chmod +x $SETUP_NAME && ./$SETUP_NAME"
