#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
ARCH="$(nm_detect_arch)"
CONFIGURATION="Release"
HOT_RELOAD="false"
SKIP_SETUP="false"
SKIP_SERVICES="false"
SKIP_SHELL_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    --hot-reload) HOT_RELOAD="true"; shift ;;
    --skip-setup) SKIP_SETUP="true"; shift ;;
    --skip-services) SKIP_SERVICES="true"; shift ;;
    --skip-shell-build) SKIP_SHELL_BUILD="true"; shift ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

if [[ "$SKIP_SETUP" != "true" ]]; then
  bash "$SCRIPT_DIR/../setup/install-toolchain.sh" --arch "$ARCH"
fi

if [[ "$HOT_RELOAD" == "true" ]]; then
  nm_require_cmd pnpm
  nm_log "starting Vite dev server"
  (cd "$REPO_ROOT" && pnpm dev:web)
  exit 0
fi

if [[ "$SKIP_SHELL_BUILD" != "true" ]]; then
  bash "$SCRIPT_DIR/../build/build-shell.sh" --platform linux --arch "$ARCH" --configuration "$CONFIGURATION"
fi

nm_warn "Linux desktop run is not implemented yet."
nm_warn "skip-services=$SKIP_SERVICES, expected binary under: $(nm_shell_exe_path "$REPO_ROOT" linux "$ARCH" "$CONFIGURATION")"
