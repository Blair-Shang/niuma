#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../shared/lib/common.sh
source "$SCRIPT_DIR/../shared/lib/common.sh"

PLATFORM="$(nm_detect_platform)"
ARCH="$(nm_detect_arch)"
CONFIGURATION="Release"
OUTPUT_DIR=""
SKIP_WEB_BUILD="false"
SKIP_SHELL_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --skip-web-build) SKIP_WEB_BUILD="true"; shift ;;
    --skip-shell-build) SKIP_SHELL_BUILD="true"; shift ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

nm_assert_native_matrix "$PLATFORM" "$ARCH"

TARGET="$SCRIPT_DIR/../platforms/$PLATFORM/pack/pack-$PLATFORM.sh"
[[ -f "$TARGET" ]] || nm_die "missing platform pack script: $TARGET"

ARGS=(--platform "$PLATFORM" --arch "$ARCH" --configuration "$CONFIGURATION")
if [[ -n "$OUTPUT_DIR" ]]; then
  ARGS+=(--output-dir "$OUTPUT_DIR")
fi
if [[ "$SKIP_WEB_BUILD" == "true" ]]; then
  ARGS+=(--skip-web-build)
fi
if [[ "$SKIP_SHELL_BUILD" == "true" ]]; then
  ARGS+=(--skip-shell-build)
fi

exec bash "$TARGET" "${ARGS[@]}"
