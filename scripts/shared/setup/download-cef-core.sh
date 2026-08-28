#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

REPO_ROOT=""
CEF_PLATFORM=""
CHANNEL="stable"
FORCE="false"

usage() {
  cat <<'EOF'
Usage: download-cef-core.sh --cef-platform <index-key> [options]

Options:
  --repo-root <path>       Repository root (auto-detected)
  --cef-platform <key>     CEF index.json platform key (linux64, macosx64, ...)
  --channel <name>         CEF channel (default: stable)
  --force                  Re-download even if third_party/cef exists
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root) REPO_ROOT="$2"; shift 2 ;;
    --cef-platform) CEF_PLATFORM="$2"; shift 2 ;;
    --channel) CHANNEL="$2"; shift 2 ;;
    --force) FORCE="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

[[ -n "$CEF_PLATFORM" ]] || { usage; nm_die "--cef-platform is required"; }

REPO_ROOT="${REPO_ROOT:-$(nm_repo_root "$SCRIPT_DIR")}"
DEST="$(nm_cef_root "$REPO_ROOT")"
CACHE_DIR="$REPO_ROOT/third_party/.cache"

if [[ -f "$DEST/CMakeLists.txt" && "$FORCE" != "true" ]]; then
  nm_log "CEF already exists at $DEST (use --force to re-download)"
  exit 0
fi

nm_require_cmd curl
nm_require_cmd tar
nm_require_cmd node

mkdir -p "$CACHE_DIR"
nm_log "fetching CEF build index ($CEF_PLATFORM, channel=$CHANNEL)"
INDEX_FILE="$CACHE_DIR/cef-index.json"
# --create-dirs: CACHE_DIR 未建时 curl 写文件会失败（Linux 23 / macOS 56）
curl -fsSL --retry 5 --retry-delay 2 --create-dirs \
  'https://cef-builds.spotifycdn.com/index.json' -o "$INDEX_FILE"

read -r CEF_VERSION ARCHIVE_NAME ARCHIVE_URL < <(
  INDEX_FILE="$INDEX_FILE" CEF_PLATFORM="$CEF_PLATFORM" CHANNEL="$CHANNEL" node <<'NODE'
const fs = require('fs');
const index = JSON.parse(fs.readFileSync(process.env.INDEX_FILE, 'utf8'));
const platformKey = process.env.CEF_PLATFORM;
const channel = process.env.CHANNEL || 'stable';
const platform = index[platformKey];
if (!platform) {
  console.error(`platform not found in index: ${platformKey}`);
  process.exit(2);
}
const versions = (platform.versions || [])
  .filter((item) => item.channel === channel)
  .sort((a, b) => {
    const av = String(a.chromium_version || '').split('.').map(Number);
    const bv = String(b.chromium_version || '').split('.').map(Number);
    for (let i = 0; i < Math.max(av.length, bv.length); i += 1) {
      const diff = (av[i] || 0) - (bv[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
const version = versions[versions.length - 1];
if (!version) {
  console.error(`no CEF version for channel=${channel} platform=${platformKey}`);
  process.exit(3);
}
const file = (version.files || []).find((item) => item.type === 'standard');
if (!file) {
  console.error(`no standard distribution for ${version.cef_version}`);
  process.exit(4);
}
process.stdout.write(`${version.cef_version} ${file.name} https://cef-builds.spotifycdn.com/${file.name}`);
NODE
)

nm_log "CEF $CEF_VERSION"
ARCHIVE_PATH="$CACHE_DIR/$ARCHIVE_NAME"

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  nm_log "downloading $ARCHIVE_URL"
  curl -fL --retry 5 --retry-delay 2 -C - --create-dirs \
    --progress-bar "$ARCHIVE_URL" -o "$ARCHIVE_PATH"
else
  nm_log "reusing cached archive $ARCHIVE_PATH"
fi

EXTRACT_DIR="$CACHE_DIR/cef_extract_${CEF_PLATFORM}_$$"
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"

nm_log "extracting archive"
if [[ "$ARCHIVE_NAME" == *.tar.xz ]]; then
  tar -xJf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"
elif [[ "$ARCHIVE_NAME" == *.tar.bz2 ]]; then
  tar -xjf "$ARCHIVE_PATH" -C "$EXTRACT_DIR"
else
  nm_die "unsupported archive format: $ARCHIVE_NAME"
fi

INNER_DIR="$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -n "$INNER_DIR" && -f "$INNER_DIR/CMakeLists.txt" ]] || nm_die "invalid CEF archive layout"

if [[ -d "$DEST" ]]; then
  rm -rf "$DEST"
fi
mv "$INNER_DIR" "$DEST"
rm -rf "$EXTRACT_DIR"

nm_log "CEF installed to $DEST"
