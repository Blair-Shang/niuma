#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../shared/lib/common.sh
source "$SCRIPT_DIR/../shared/lib/common.sh"

PLATFORM="$(nm_detect_platform)"
ARCH="$(nm_detect_arch)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

TARGET="$SCRIPT_DIR/../platforms/$PLATFORM/setup/install-toolchain.sh"
[[ -f "$TARGET" ]] || nm_die "missing platform setup script: $TARGET"
exec bash "$TARGET" --arch "$ARCH"
