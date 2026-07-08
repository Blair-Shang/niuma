#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
ARCH="$(nm_detect_arch)"
DELVE="false"
SKIP_BUILD="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --delve) DELVE="true"; shift ;;
    --skip-build) SKIP_BUILD="true"; shift ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

nm_require_cmd go
nm_log "Linux platform-core foreground"
nm_log "arch: $ARCH"

cd "$REPO_ROOT/platform"
if [[ "$DELVE" == "true" ]]; then
  nm_die "delve flow for Linux platform-core is not implemented yet"
elif [[ "$SKIP_BUILD" == "true" ]]; then
  nm_die "reuse of prebuilt Linux platform-core binary is not implemented yet"
else
  exec go run ./cmd/platform-core
fi
