#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

bash "$SCRIPT_DIR/../../linux/pack/pack-linux.sh" \
  --platform kylin \
  --format deb \
  --package-id niuma-kylin \
  --vendor "NiuMa Kylin" \
  "$@"
