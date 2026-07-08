#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../shared/lib/common.sh
source "$SCRIPT_DIR/../shared/lib/common.sh"

TARGET=""
PLATFORM="$(nm_detect_platform)"
ARCH="$(nm_detect_arch)"
CONFIGURATION="Release"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

nm_assert_native_matrix "$PLATFORM" "$ARCH"

case "$TARGET" in
  services)
    exec bash "$SCRIPT_DIR/../shared/build/build-services.sh" \
      --platform "$PLATFORM" \
      --arch "$ARCH" \
      --configuration "$CONFIGURATION"
    ;;
  shell)
    TARGET_SCRIPT="$SCRIPT_DIR/../platforms/$PLATFORM/build/build-shell.sh"
    [[ -f "$TARGET_SCRIPT" ]] || nm_die "missing platform build script: $TARGET_SCRIPT"
    exec bash "$TARGET_SCRIPT" --platform "$PLATFORM" --arch "$ARCH" --configuration "$CONFIGURATION"
    ;;
  *)
    nm_die "--target must be one of: services, shell"
    ;;
esac
