#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../shared/lib/common.sh
source "$SCRIPT_DIR/../shared/lib/common.sh"

PLATFORM="$(nm_detect_platform)"
ARCH="$(nm_detect_arch)"
CONFIGURATION="Release"
HOT_RELOAD="false"
SKIP_SETUP="false"
SKIP_SERVICES="false"
SKIP_SHELL_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    --hot-reload) HOT_RELOAD="true"; shift ;;
    --skip-setup) SKIP_SETUP="true"; shift ;;
    --skip-services) SKIP_SERVICES="true"; shift ;;
    --skip-shell-build) SKIP_SHELL_BUILD="true"; shift ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

TARGET="$SCRIPT_DIR/../platforms/$PLATFORM/run/dev.sh"
[[ -f "$TARGET" ]] || nm_die "missing platform dev script: $TARGET"

ARGS=(--arch "$ARCH" --configuration "$CONFIGURATION")
if [[ "$HOT_RELOAD" == "true" ]]; then
  ARGS+=(--hot-reload)
fi
if [[ "$SKIP_SETUP" == "true" ]]; then
  ARGS+=(--skip-setup)
fi
if [[ "$SKIP_SERVICES" == "true" ]]; then
  ARGS+=(--skip-services)
fi
if [[ "$SKIP_SHELL_BUILD" == "true" ]]; then
  ARGS+=(--skip-shell-build)
fi

exec bash "$TARGET" "${ARGS[@]}"
