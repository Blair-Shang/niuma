#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
PLATFORM="macos"
ARCH="$(nm_detect_arch)"
CONFIGURATION="Release"
BUILD_DIR="$(nm_shell_build_dir "$REPO_ROOT" "$PLATFORM" "$ARCH")"
SHELL_DIR="$REPO_ROOT/shell"
CEF_ROOT="${CEF_ROOT:-$(nm_cef_root "$REPO_ROOT")}"
SKIP_WEB_BUILD="false"
SKIP_SERVICES="false"
ALLOW_STUB="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    --skip-web-build) SKIP_WEB_BUILD="true"; shift ;;
    --skip-services) SKIP_SERVICES="true"; shift ;;
    --allow-stub) ALLOW_STUB="true"; shift ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

BUILD_DIR="$(nm_shell_build_dir "$REPO_ROOT" "$PLATFORM" "$ARCH")"

nm_require_cmd cmake
nm_require_cmd pnpm

nm_emit_build_info "$REPO_ROOT"
read -r -a CMAKE_VERSION_ARGS < <(nm_cmake_version_args "$REPO_ROOT")

if [[ "$ALLOW_STUB" != "true" && ! -f "$CEF_ROOT/CMakeLists.txt" ]]; then
  nm_die "CEF not found at $CEF_ROOT. Run: bash scripts/entry/cef-download.sh --platform macos"
fi

if [[ "$SKIP_WEB_BUILD" != "true" ]]; then
  nm_log "build web"
  (cd "$REPO_ROOT" && pnpm build:web)
fi

CMAKE_ARCH="x86_64"
if [[ "$ARCH" == "arm64" ]]; then
  CMAKE_ARCH="arm64"
fi

mkdir -p "$BUILD_DIR"
if [[ -f "$CEF_ROOT/CMakeLists.txt" ]]; then
  nm_log "cmake configure (CEF enabled, $PLATFORM-$ARCH)"
  cmake -S "$SHELL_DIR" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE="$CONFIGURATION" \
    -DCMAKE_OSX_ARCHITECTURES="$CMAKE_ARCH" \
    -DCEF_ROOT="$CEF_ROOT" \
    "${CMAKE_VERSION_ARGS[@]}"
else
  nm_warn "CEF not found at $CEF_ROOT; building stub shell"
  cmake -S "$SHELL_DIR" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE="$CONFIGURATION" \
    -DCMAKE_OSX_ARCHITECTURES="$CMAKE_ARCH" \
    "${CMAKE_VERSION_ARGS[@]}"
fi

nm_log "cmake build $CONFIGURATION"
cmake --build "$BUILD_DIR" --config "$CONFIGURATION"

OUTPUT_BIN="$(nm_shell_exe_path "$REPO_ROOT" "$PLATFORM" "$ARCH" "$CONFIGURATION")"
[[ -f "$OUTPUT_BIN" ]] || nm_die "niuma binary not found under $BUILD_DIR"

if [[ "$ALLOW_STUB" != "true" ]]; then
  SHELL_INSTALL="$(dirname "$OUTPUT_BIN")"
  if [[ ! -d "$SHELL_INSTALL/Chromium Embedded Framework.framework" ]]; then
    nm_die "CEF framework missing next to $OUTPUT_BIN. Re-run CEF download and rebuild shell."
  fi
fi

if [[ "$SKIP_SERVICES" != "true" ]]; then
  bash "$REPO_ROOT/scripts/shared/package/stage-services.sh" \
    --install-dir "$(dirname "$OUTPUT_BIN")" \
    --platform "$PLATFORM" \
    --arch "$ARCH" \
    --configuration "$CONFIGURATION"
fi

nm_sync_legacy_shell "$REPO_ROOT" "$PLATFORM" "$ARCH" "$CONFIGURATION"

nm_log "built -> $OUTPUT_BIN"
