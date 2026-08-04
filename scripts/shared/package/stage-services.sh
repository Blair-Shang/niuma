#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

INSTALL_DIR=""
PLATFORM="$(nm_detect_platform)"
ARCH="$(nm_detect_arch)"
CONFIGURATION="Release"
SKIP_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD="true"; shift ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

[[ -n "$INSTALL_DIR" ]] || nm_die "--install-dir is required"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
BIN_SRC="$REPO_ROOT/services/bin"
TARGET_BIN_SRC="$BIN_SRC/$PLATFORM-$ARCH"
MAN_SRC="$REPO_ROOT/services/manifests"
BIN_DST="$INSTALL_DIR/services/bin"
MAN_DST="$INSTALL_DIR/services/manifests"

if [[ "$SKIP_BUILD" != "true" ]]; then
  bash "$SCRIPT_DIR/../build/build-services.sh" \
    --platform "$PLATFORM" \
    --arch "$ARCH" \
    --configuration "$CONFIGURATION"
fi

[[ -f "$TARGET_BIN_SRC/niuma-platform-core" || -f "$TARGET_BIN_SRC/niuma-platform-core.exe" ]] || nm_die "missing platform-core under $TARGET_BIN_SRC"

mkdir -p "$BIN_DST" "$MAN_DST"
# 生产 stage 只认矩阵目录，不从平铺 services/bin 回退（避免旧产物污染）
cp -R "$TARGET_BIN_SRC/." "$BIN_DST/"

# 旁载 runtime：仅同步 README / .gitkeep，不打入厂商 DLL/so
if [[ -d "$BIN_SRC/runtime" ]]; then
  while IFS= read -r -d '' file; do
    base="$(basename "$file")"
    lower="$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]')"
    case "$lower" in
      readme.txt|readme.md|.gitkeep) ;;
      *) continue ;;
    esac
    rel="${file#"$BIN_SRC/runtime/"}"
    dest="$BIN_DST/runtime/$rel"
    mkdir -p "$(dirname "$dest")"
    cp -f "$file" "$dest"
  done < <(find "$BIN_SRC/runtime" -type f -print0 2>/dev/null || true)
fi

cp -R "$MAN_SRC/." "$MAN_DST/"
chmod 0755 "$BIN_DST"/niuma-* 2>/dev/null || true

nm_log "services staged -> $INSTALL_DIR/services (matrix-only: $TARGET_BIN_SRC)"
