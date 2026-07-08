#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../shared/lib/common.sh
source "$SCRIPT_DIR/../shared/lib/common.sh"

PLATFORM="$(nm_detect_platform)"
ARCH="$(nm_detect_arch)"
DELVE="false"
SKIP_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --delve) DELVE="true"; shift ;;
    --skip-build) SKIP_BUILD="true"; shift ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

TARGET="$SCRIPT_DIR/../platforms/$PLATFORM/run/dev-platform.sh"
[[ -f "$TARGET" ]] || nm_die "missing platform dev-platform script: $TARGET"

ARGS=(--arch "$ARCH")
if [[ "$DELVE" == "true" ]]; then
  ARGS+=(--delve)
fi
if [[ "$SKIP_BUILD" == "true" ]]; then
  ARGS+=(--skip-build)
fi

exec bash "$TARGET" "${ARGS[@]}"
