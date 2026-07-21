#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
BIN_DIR="$REPO_ROOT/services/bin"
PLATFORM="$(nm_detect_platform)"
ARCH="$(nm_detect_arch)"
CONFIGURATION="Release"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

TARGET_BIN_DIR="$BIN_DIR/$PLATFORM-$ARCH"
GO_LDFLAGS="$(nm_go_ldflags "$CONFIGURATION" "$REPO_ROOT")"

nm_assert_native_matrix "$PLATFORM" "$ARCH"
nm_require_cmd go
mkdir -p "$BIN_DIR" "$TARGET_BIN_DIR"

go_target() {
  case "$1/$2" in
    windows/x64) echo "windows amd64" ;;
    windows/arm64) echo "windows arm64" ;;
    linux/x64|kylin/x64) echo "linux amd64" ;;
    linux/arm64|kylin/arm64) echo "linux arm64" ;;
    macos/x64) echo "darwin amd64" ;;
    macos/arm64) echo "darwin arm64" ;;
    *) nm_die "unsupported go target: $1/$2" ;;
  esac
}

rust_target() {
  case "$1/$2" in
    windows/x64) echo "x86_64-pc-windows-msvc" ;;
    windows/arm64) echo "aarch64-pc-windows-msvc" ;;
    linux/x64|kylin/x64) echo "x86_64-unknown-linux-gnu" ;;
    linux/arm64|kylin/arm64) echo "aarch64-unknown-linux-gnu" ;;
    macos/x64) echo "x86_64-apple-darwin" ;;
    macos/arm64) echo "aarch64-apple-darwin" ;;
    *) nm_die "unsupported rust target: $1/$2" ;;
  esac
}

binary_name() {
  if [[ "$2" == "windows" ]]; then
    printf '%s.exe\n' "$1"
  else
    printf '%s\n' "$1"
  fi
}

should_sync_legacy_bin() {
  [[ "$PLATFORM" == "$(nm_detect_platform)" && "$ARCH" == "$(nm_detect_arch)" ]]
}

build_go_service() {
  local module_dir="$1"
  local pkg="$2"
  local output="$3"
  read -r goos goarch < <(go_target "$PLATFORM" "$ARCH")
  nm_log "go build $pkg -> $output ($goos/$goarch)"
  (
    cd "$module_dir"
    GOOS="$goos" GOARCH="$goarch" go build -ldflags "$GO_LDFLAGS" -o "$output" "$pkg"
  )
}

build_rust_service() {
  local crate_dir="$1"
  local bin_name="$2"
  local output="$3"
  if ! command -v cargo >/dev/null 2>&1; then
    nm_warn "skip $bin_name (cargo not found - install Rust: https://rustup.rs)"
    return 1
  fi
  local target_triple
  target_triple="$(rust_target "$PLATFORM" "$ARCH")"
  local version build_id
  version="$(nm_build_info_value "$REPO_ROOT" ".version")"
  build_id="$(nm_build_info_value "$REPO_ROOT" ".buildId")"
  export NIUMMA_APP_VERSION="$version"
  export NIUMMA_BUILD_ID="$build_id"
  nm_log "cargo build $bin_name -> $output ($target_triple)"
  (
    cd "$crate_dir"
    if [[ "$CONFIGURATION" == "Release" ]]; then
      cargo build --target "$target_triple" --release
      cp "target/$target_triple/release/$(binary_name "$bin_name" "$PLATFORM")" "$output"
    else
      cargo build --target "$target_triple"
      cp "target/$target_triple/debug/$(binary_name "$bin_name" "$PLATFORM")" "$output"
    fi
  )
  chmod 0755 "$output"
}

nm_log "go generate (sync SQL migrations)"
(cd "$REPO_ROOT/platform/internal/migrate" && go generate ./...)

platform_out="$TARGET_BIN_DIR/$(binary_name niuma-platform-core "$PLATFORM")"
ftp_out="$TARGET_BIN_DIR/$(binary_name niuma-ftp-service "$PLATFORM")"
ssh_out="$TARGET_BIN_DIR/$(binary_name niuma-ssh-service "$PLATFORM")"
redis_out="$TARGET_BIN_DIR/$(binary_name niuma-redis-service "$PLATFORM")"
mongo_out="$TARGET_BIN_DIR/$(binary_name niuma-mongodb-service "$PLATFORM")"
vastbase_out="$TARGET_BIN_DIR/$(binary_name niuma-vastbase-service "$PLATFORM")"
mysql_out="$TARGET_BIN_DIR/$(binary_name niuma-mysql-service "$PLATFORM")"
mcp_vast_out="$TARGET_BIN_DIR/$(binary_name mcp-vastbase-readonly "$PLATFORM")"

build_go_service "$REPO_ROOT/platform" "./cmd/platform-core" "$platform_out"
build_go_service "$REPO_ROOT/services/ftp-service" "./cmd/ftp-service" "$ftp_out"
build_go_service "$REPO_ROOT/services/mongodb-service" "./cmd/mongodb-service" "$mongo_out"
build_go_service "$REPO_ROOT/services/vastbase-service" "./cmd/vastbase-service" "$vastbase_out"
build_go_service "$REPO_ROOT/services/mysql-service" "./cmd/mysql-service" "$mysql_out"
build_go_service "$REPO_ROOT/services/mcp-vastbase-readonly" "." "$mcp_vast_out"
ssh_built="false"
if build_rust_service "$REPO_ROOT/services/ssh-service" "niuma-ssh-service" "$ssh_out"; then
  ssh_built="true"
fi
redis_built="false"
if build_rust_service "$REPO_ROOT/services/redis-service" "niuma-redis-service" "$redis_out"; then
  redis_built="true"
fi

if should_sync_legacy_bin; then
  cp "$platform_out" "$BIN_DIR/$(binary_name niuma-platform-core "$PLATFORM")"
  cp "$ftp_out" "$BIN_DIR/$(binary_name niuma-ftp-service "$PLATFORM")"
  cp "$mongo_out" "$BIN_DIR/$(binary_name niuma-mongodb-service "$PLATFORM")"
  cp "$vastbase_out" "$BIN_DIR/$(binary_name niuma-vastbase-service "$PLATFORM")"
  cp "$mysql_out" "$BIN_DIR/$(binary_name niuma-mysql-service "$PLATFORM")"
  cp "$mcp_vast_out" "$BIN_DIR/$(binary_name mcp-vastbase-readonly "$PLATFORM")"
  if [[ "$ssh_built" == "true" && -f "$ssh_out" ]]; then
    cp "$ssh_out" "$BIN_DIR/$(binary_name niuma-ssh-service "$PLATFORM")"
  fi
  if [[ "$redis_built" == "true" && -f "$redis_out" ]]; then
    cp "$redis_out" "$BIN_DIR/$(binary_name niuma-redis-service "$PLATFORM")"
  fi
fi

nm_log "services ready for $PLATFORM/$ARCH -> $TARGET_BIN_DIR"
