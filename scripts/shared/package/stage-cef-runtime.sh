#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

PLATFORM=""
ARCH=""
CEF_ROOT=""
SOURCE_DIR=""
DEST_DIR=""
CONFIGURATION="Release"

usage() {
  cat <<'EOF'
Usage: stage-cef-runtime.sh --platform <os> --dest <dir> [options]

Copy CEF runtime artifacts into a distributable directory.

Options:
  --platform <name>        windows | linux | kylin | macos
  --arch <arch>            x64 | arm64 (default: host arch)
  --dest <dir>             Target directory (required)
  --source <dir>           Prefer artifacts from shell build/install dir
  --cef-root <dir>         CEF distribution root (default: third_party/cef)
  --configuration <name>   Release | Debug (default: Release)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --dest) DEST_DIR="$2"; shift 2 ;;
    --source) SOURCE_DIR="$2"; shift 2 ;;
    --cef-root) CEF_ROOT="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

[[ -n "$PLATFORM" ]] || { usage; nm_die "--platform is required"; }
[[ -n "$DEST_DIR" ]] || { usage; nm_die "--dest is required"; }

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
ARCH="${ARCH:-$(nm_detect_arch)}"
CEF_ROOT="${CEF_ROOT:-$(nm_cef_root "$REPO_ROOT")}"
CONFIG_LOWER="$(printf '%s' "$CONFIGURATION" | tr '[:upper:]' '[:lower:]')"

mkdir -p "$DEST_DIR"

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ -e "$src" ]]; then
    if [[ -d "$src" ]]; then
      mkdir -p "$dst"
      cp -R "$src/." "$dst/"
    else
      mkdir -p "$(dirname "$dst")"
      cp -f "$src" "$dst"
    fi
  fi
}

stage_linux_like() {
  local binary_dir="$CEF_ROOT/$CONFIGURATION"
  local resource_dir="$CEF_ROOT/Resources"
  if [[ -n "$SOURCE_DIR" ]]; then
    binary_dir="$SOURCE_DIR"
    resource_dir="$SOURCE_DIR"
  fi

  local binaries=(
    chrome-sandbox
    libcef.so
    libEGL.so
    libGLESv2.so
    libvk_swiftshader.so
    libvulkan.so.1
    v8_context_snapshot.bin
    vk_swiftshader_icd.json
  )
  local resources=(
    chrome_100_percent.pak
    chrome_200_percent.pak
    resources.pak
    icudtl.dat
  )

  local item
  for item in "${binaries[@]}"; do
    copy_if_exists "$binary_dir/$item" "$DEST_DIR/$item"
  done
  for item in "${resources[@]}"; do
    copy_if_exists "$resource_dir/$item" "$DEST_DIR/$item"
  done
  copy_if_exists "$resource_dir/locales" "$DEST_DIR/locales"

  [[ -f "$DEST_DIR/libcef.so" ]] || nm_die "libcef.so missing in $DEST_DIR (build shell first or set --cef-root)"
}

stage_macos() {
  local binary_dir="$CEF_ROOT/$CONFIGURATION"
  local framework_name="Chromium Embedded Framework.framework"
  if [[ -n "$SOURCE_DIR" ]]; then
    binary_dir="$SOURCE_DIR"
  fi

  local framework_src="$binary_dir/$framework_name"
  [[ -d "$framework_src" ]] || framework_src="$CEF_ROOT/$CONFIGURATION/$framework_name"
  [[ -d "$framework_src" ]] || nm_die "macOS CEF framework not found (expected under build output or $CEF_ROOT/$CONFIGURATION)"

  local frameworks_dir="$DEST_DIR"
  if [[ "$(basename "$DEST_DIR")" == "MacOS" ]]; then
    frameworks_dir="$(dirname "$(dirname "$DEST_DIR")")/Frameworks"
  elif [[ "$(basename "$DEST_DIR")" == "Contents" ]]; then
    frameworks_dir="$DEST_DIR/Frameworks"
  elif [[ "$DEST_DIR" == *.app/Contents/MacOS ]]; then
    frameworks_dir="${DEST_DIR%/MacOS}/Frameworks"
  fi

  mkdir -p "$frameworks_dir"
  rm -rf "$frameworks_dir/$framework_name"
  cp -R "$framework_src" "$frameworks_dir/"

  local resource_candidates=(
    "$binary_dir"
    "$framework_src/Resources"
    "$CEF_ROOT/Resources"
  )
  local resources=(
    chrome_100_percent.pak
    chrome_200_percent.pak
    resources.pak
    icudtl.dat
  )
  local resources_dir="$DEST_DIR"
  if [[ "$(basename "$DEST_DIR")" == "MacOS" ]]; then
    resources_dir="$(dirname "$(dirname "$DEST_DIR")")/Resources"
  elif [[ "$(basename "$DEST_DIR")" == "Contents" ]]; then
    resources_dir="$DEST_DIR/Resources"
  fi
  mkdir -p "$resources_dir"

  local base item
  for base in "${resource_candidates[@]}"; do
    for item in "${resources[@]}"; do
      copy_if_exists "$base/$item" "$resources_dir/$item"
    done
    copy_if_exists "$base/locales" "$resources_dir/locales"
  done

  [[ -d "$frameworks_dir/$framework_name" ]] || nm_die "failed to stage macOS CEF framework"
}

stage_windows() {
  nm_die "stage-cef-runtime.sh does not stage Windows; use bundle-windows.ps1 or shell build output"
}

case "$PLATFORM" in
  linux|kylin) stage_linux_like ;;
  macos) stage_macos ;;
  windows) stage_windows ;;
  *) nm_die "unsupported platform: $PLATFORM" ;;
esac

nm_log "CEF runtime staged -> $DEST_DIR"
