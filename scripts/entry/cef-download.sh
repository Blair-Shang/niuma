#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../shared/lib/common.sh
source "$SCRIPT_DIR/../shared/lib/common.sh"

PLATFORM="$(nm_detect_platform)"
ARCH="$(nm_detect_arch)"
MAX_RETRIES=3
RETRY_DELAY=10

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

TARGET="$SCRIPT_DIR/../platforms/$PLATFORM/setup/download-cef.sh"
[[ -f "$TARGET" ]] || nm_die "missing platform CEF/runtime download script: $TARGET"

attempt=1
delay="$RETRY_DELAY"
while [[ "$attempt" -le "$MAX_RETRIES" ]]; do
  nm_log "CEF download attempt $attempt/$MAX_RETRIES"
  if bash "$TARGET" --arch "$ARCH"; then
    exit 0
  fi
  if [[ "$attempt" -eq "$MAX_RETRIES" ]]; then
    break
  fi
  nm_warn "CEF download failed, retrying in ${delay}s"
  sleep "$delay"
  delay=$((delay * 2))
  attempt=$((attempt + 1))
done

nm_die "CEF download failed after $MAX_RETRIES attempts"
