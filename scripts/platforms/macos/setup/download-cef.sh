#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

ARCH="$(nm_detect_arch)"
FORCE="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --force) FORCE="true"; shift ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
CEF_PLATFORM="$(nm_cef_index_platform macos "$ARCH")"
ARGS=(--repo-root "$REPO_ROOT" --cef-platform "$CEF_PLATFORM")
if [[ "$FORCE" == "true" ]]; then
  ARGS+=(--force)
fi

exec bash "$REPO_ROOT/scripts/shared/setup/download-cef-core.sh" "${ARGS[@]}"
