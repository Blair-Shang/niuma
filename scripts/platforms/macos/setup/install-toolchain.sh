#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

ARCH="$(nm_detect_arch)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

nm_log "macOS desktop setup"
nm_log "target arch: $ARCH"
nm_require_cmd cmake
nm_require_cmd pnpm
nm_require_cmd curl
nm_require_cmd tar

bash "$SCRIPT_DIR/download-cef.sh" --arch "$ARCH"
nm_log "macOS desktop setup complete"
