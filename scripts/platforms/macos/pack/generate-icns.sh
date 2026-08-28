#!/usr/bin/env bash
# 从品牌 PNG 生成 AppIcon.icns（需 macOS iconutil / sips）。
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
DEST="${1:-}"
[[ -n "$DEST" ]] || nm_die "usage: generate-icns.sh <dest.icns>"

SRC=""
for candidate in \
  "$REPO_ROOT/assets/brand/app-icon-256.png" \
  "$REPO_ROOT/web/public/app-icon-256.png" \
  "$REPO_ROOT/assets/brand/app-icon-512.png"
do
  if [[ -f "$candidate" ]]; then
    SRC="$candidate"
    break
  fi
done

if [[ -z "$SRC" ]]; then
  nm_warn "no brand PNG found; skip AppIcon.icns"
  exit 0
fi

if ! command -v iconutil >/dev/null 2>&1 || ! command -v sips >/dev/null 2>&1; then
  nm_warn "iconutil/sips not found; skip AppIcon.icns"
  exit 0
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/niuma-icns.XXXXXX")"
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

make_size() {
  local px="$1"
  local name="$2"
  sips -z "$px" "$px" "$SRC" --out "$ICONSET/$name" >/dev/null
}

make_size 16 icon_16x16.png
make_size 32 icon_16x16@2x.png
make_size 32 icon_32x32.png
make_size 64 icon_32x32@2x.png
make_size 128 icon_128x128.png
make_size 256 icon_128x128@2x.png
make_size 256 icon_256x256.png
make_size 512 icon_256x256@2x.png
make_size 512 icon_512x512.png
make_size 512 icon_512x512@2x.png

mkdir -p "$(dirname "$DEST")"
iconutil -c icns "$ICONSET" -o "$DEST"
nm_log "AppIcon.icns -> $DEST"
