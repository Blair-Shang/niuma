#!/usr/bin/env bash
set -euo pipefail

# 将目录打成自解压 .run（shell archive + tar.gz）
# Usage: make-self-extracting-run.sh <payload_dir> <output.run> <app_name> <app_version> [entry_script]

PAYLOAD_DIR="${1:-}"
OUTPUT_RUN="${2:-}"
APP_NAME="${3:-NiuMa}"
APP_VERSION="${4:-0.0.0}"
ENTRY_SCRIPT="${5:-install.sh}"

[[ -d "$PAYLOAD_DIR" ]] || { echo "payload dir required" >&2; exit 1; }
[[ -n "$OUTPUT_RUN" ]] || { echo "output .run path required" >&2; exit 1; }

MARKER='__NIUMMA_ARCHIVE_BELOW__'
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

PAYLOAD_TAR="$WORK_DIR/payload.tar.gz"
tar -C "$PAYLOAD_DIR" -czf "$PAYLOAD_TAR" .

HEADER="$WORK_DIR/header.sh"
cat > "$HEADER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
MARKER='$MARKER'
TMPDIR="\$(mktemp -d)"
cleanup() { rm -rf "\$TMPDIR"; }
trap cleanup EXIT
ARCHIVE_LINE=\$(awk '/^\$MARKER\$/ {print NR + 1; exit 0; }' "\$0")
tail -n +\$ARCHIVE_LINE "\$0" | tar -xz -C "\$TMPDIR"
export NIUMMA_APP_NAME='$APP_NAME'
export NIUMMA_APP_VERSION='$APP_VERSION'
chmod +x "\$TMPDIR/$ENTRY_SCRIPT"
exec "\$TMPDIR/$ENTRY_SCRIPT"
EOF

chmod +x "$HEADER"
mkdir -p "$(dirname "$OUTPUT_RUN")"
cat "$HEADER" > "$OUTPUT_RUN"
echo "$MARKER" >> "$OUTPUT_RUN"
cat "$PAYLOAD_TAR" >> "$OUTPUT_RUN"
chmod +x "$OUTPUT_RUN"
