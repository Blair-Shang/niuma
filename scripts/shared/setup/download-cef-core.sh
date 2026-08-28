#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

REPO_ROOT=""
CEF_PLATFORM=""
FORCE="false"

usage() {
  cat <<'EOF'
Usage: download-cef-core.sh --cef-platform <index-key> [options]

Options:
  --repo-root <path>       Repository root (auto-detected)
  --cef-platform <key>     CEF index.json platform key (linux64, macosarm64, ...)
  --force                  Re-download even if third_party/cef exists
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root) REPO_ROOT="$2"; shift 2 ;;
    --cef-platform) CEF_PLATFORM="$2"; shift 2 ;;
    --channel) shift 2 ;;
    --force) FORCE="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

[[ -n "$CEF_PLATFORM" ]] || { usage; nm_die "--cef-platform is required"; }
if [[ "$CEF_PLATFORM" == "linuxx64" ]]; then
  CEF_PLATFORM="linux64"
fi

REPO_ROOT="${REPO_ROOT:-$(nm_repo_root "$SCRIPT_DIR")}"
DEST="$(nm_cef_root "$REPO_ROOT")"
CACHE_DIR="$REPO_ROOT/third_party/cef-cache"
STAGE_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/niuma-cef-dl"
PIN_FILE="$SCRIPT_DIR/cef-pin.txt"

if [[ -f "$DEST/CMakeLists.txt" && "$FORCE" != "true" ]]; then
  nm_log "CEF already exists at $DEST (use --force to re-download)"
  exit 0
fi

nm_require_cmd curl
nm_require_cmd tar

[[ -f "$PIN_FILE" ]] || nm_die "missing CEF pin file: $PIN_FILE"
CEF_VERSION="$(awk -F= '$1=="cef_version" {print substr($0, index($0,"=")+1); exit}' "$PIN_FILE")"
[[ -n "$CEF_VERSION" ]] || nm_die "cef_version missing in $PIN_FILE"

ARCHIVE_NAME="cef_binary_${CEF_VERSION}_${CEF_PLATFORM}.tar.bz2"
ARCHIVE_URL="https://cef-builds.spotifycdn.com/${ARCHIVE_NAME}"

mkdir -p "$CACHE_DIR" "$STAGE_DIR"
nm_log "CEF $CEF_VERSION ($CEF_PLATFORM)"
ARCHIVE_PATH="$CACHE_DIR/$ARCHIVE_NAME"

download_archive() {
  local url="$1"
  local out="$2"
  local attempt=1
  local max=3
  local delay=10
  while [[ "$attempt" -le "$max" ]]; do
    nm_log "download attempt $attempt/$max"
    if curl -fL --retry 5 --retry-delay 2 -C - --create-dirs --progress-bar "$url" -o "$out"; then
      return 0
    fi
    nm_warn "download failed (attempt $attempt/$max)"
    if [[ "$attempt" -eq "$max" ]]; then
      return 1
    fi
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  nm_log "downloading $ARCHIVE_URL"
  STAGE_ARCHIVE="$STAGE_DIR/$ARCHIVE_NAME"
  download_archive "$ARCHIVE_URL" "$STAGE_ARCHIVE" || nm_die "CEF archive download failed"
  mv -f "$STAGE_ARCHIVE" "$ARCHIVE_PATH"
else
  nm_log "reusing cached archive $ARCHIVE_PATH"
fi

EXTRACT_DIR="$CACHE_DIR/cef_extract_${CEF_PLATFORM}_$$"
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"

nm_log "extracting archive (no progress; large bz2 may take several minutes)"
if [[ "$ARCHIVE_NAME" == *.tar.xz ]]; then
  tar -xJf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"
elif [[ "$ARCHIVE_NAME" == *.tar.bz2 ]]; then
  tar -xjf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"
else
  nm_die "unsupported archive format: $ARCHIVE_NAME"
fi

INNER_DIR=""
for d in "$EXTRACT_DIR"/*; do
  if [[ -d "$d" ]]; then
    INNER_DIR="$d"
    break
  fi
done
[[ -n "$INNER_DIR" && -f "$INNER_DIR/CMakeLists.txt" ]] || nm_die "invalid CEF archive layout"

if [[ -d "$DEST" ]]; then
  rm -rf "$DEST"
fi
mv "$INNER_DIR" "$DEST"
rm -rf "$EXTRACT_DIR"

nm_log "CEF installed to $DEST"
