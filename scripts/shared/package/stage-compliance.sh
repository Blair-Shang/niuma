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
if [[ -f "$REPO_ROOT/LICENSE" ]]; then
  cp "$REPO_ROOT/LICENSE" "$DEST_DIR/licenses/LICENSE"
fi
if [[ -f "$REPO_ROOT/NOTICE" ]]; then
  cp "$REPO_ROOT/NOTICE" "$DEST_DIR/licenses/NOTICE"
fi
if [[ -f "$REPO_ROOT/docs/compliance/NOTICES.txt" ]]; then
  cp "$REPO_ROOT/docs/compliance/NOTICES.txt" "$DEST_DIR/licenses/NOTICES.txt"
fi
for legal in DISCLAIMER.zh-CN.txt DISCLAIMER.en-US.txt EULA.zh-CN.txt EULA.en-US.txt; do
  if [[ -f "$REPO_ROOT/docs/legal/$legal" ]]; then
    cp "$REPO_ROOT/docs/legal/$legal" "$DEST_DIR/licenses/$legal"
  fi
done
if [[ -f "$REPO_ROOT/build/version.json" ]]; then
  cp "$REPO_ROOT/build/version.json" "$DEST_DIR/version.json"
fi

nm_log "compliance files staged -> $DEST_DIR/licenses"
