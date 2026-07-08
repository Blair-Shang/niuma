#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../shared/lib/common.sh
source "$SCRIPT_DIR/../shared/lib/common.sh"
REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
nm_emit_build_info "$REPO_ROOT"
nm_log "version=$(nm_build_info_value "$REPO_ROOT" ".version") buildId=$(nm_build_info_value "$REPO_ROOT" ".buildId")"
