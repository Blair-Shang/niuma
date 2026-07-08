#!/usr/bin/env bash
set -euo pipefail
# Usage: stage-compliance.sh <dest_dir> [repo_root]

DEST_DIR="${1:-}"
REPO_ROOT="${2:-}"

if [[ -z "$DEST_DIR" ]]; then
  echo "usage: stage-compliance.sh <dest_dir> [repo_root]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
fi

mkdir -p "$DEST_DIR/licenses"

if [[ -f "$REPO_ROOT/third_party/cef/LICENSE.txt" ]]; then
  cp "$REPO_ROOT/third_party/cef/LICENSE.txt" "$DEST_DIR/licenses/CEF-LICENSE.txt"
fi
if [[ -f "$REPO_ROOT/third_party/cef/README.txt" ]]; then
  cp "$REPO_ROOT/third_party/cef/README.txt" "$DEST_DIR/licenses/CEF-README.txt"
fi
if [[ -f "$REPO_ROOT/docs/compliance/NOTICES.txt" ]]; then
  cp "$REPO_ROOT/docs/compliance/NOTICES.txt" "$DEST_DIR/licenses/NOTICES.txt"
fi
if [[ -f "$REPO_ROOT/build/version.json" ]]; then
  cp "$REPO_ROOT/build/version.json" "$DEST_DIR/version.json"
fi

nm_log "compliance files staged -> $DEST_DIR/licenses"
