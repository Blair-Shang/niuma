#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

ARCH="${ARCH:-$(nm_detect_arch)}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

bash "$SCRIPT_DIR/../../linux/setup/install-toolchain.sh" --arch "$ARCH"
nm_log "Kylin distro overrides"
nm_warn "verify distro-specific dependencies such as libgtk, libnss3, libxss1, libasound2 and enterprise signing policy."
