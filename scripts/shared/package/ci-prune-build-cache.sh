#!/usr/bin/env bash
set -euo pipefail
# CI 打包前释放磁盘：删除编译缓存与已 stage 过的 CEF 发行包。
# 保留 web/dist、services/bin、壳层二进制及其旁边的 CEF 运行时，供 pack 使用。
# 非 CI 环境直接退出，避免误删本机增量构建产物。

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

if [[ "${CI:-}" != "true" ]]; then
  exit 0
fi

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
PLATFORM="$(nm_detect_platform)"
ARCH="$(nm_detect_arch)"

nm_log "CI disk before prune"
df -h "$REPO_ROOT" 2>/dev/null || df -h

UI_MODULES="$(cd "$REPO_ROOT/.." && pwd)/niuma-ui/node_modules"
if [[ -d "$UI_MODULES" ]]; then
  nm_log "remove niuma-ui/node_modules"
  rm -rf "$UI_MODULES"
fi

prune_rust_target() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    nm_log "remove $dir"
    rm -rf "$dir"
  fi
}

prune_rust_target "$REPO_ROOT/services/ssh-service/target"
prune_rust_target "$REPO_ROOT/services/sftp-service/target"
prune_rust_target "$REPO_ROOT/services/redis-service/target"
if [[ -d "$REPO_ROOT/packages/rust" ]]; then
  find "$REPO_ROOT/packages/rust" -mindepth 2 -maxdepth 2 -type d -name target -print0 \
    | while IFS= read -r -d '' t; do
      nm_log "remove $t"
      rm -rf "$t"
    done
fi

SHELL_BIN="$(nm_shell_exe_path "$REPO_ROOT" "$PLATFORM" "$ARCH" "Release")"
SHELL_DIR="$(dirname "$SHELL_BIN")"
CEF_READY="false"
if [[ "$PLATFORM" == "macos" ]]; then
  [[ -d "$SHELL_DIR/Chromium Embedded Framework.framework" ]] && CEF_READY="true"
elif [[ -f "$SHELL_DIR/libcef.so" ]]; then
  CEF_READY="true"
fi

# pack 从壳层目录 stage CEF，不再需要 third_party 里那份完整发行包。
if [[ "$CEF_READY" == "true" ]]; then
  if [[ -d "$REPO_ROOT/third_party/cef" ]]; then
    nm_log "remove third_party/cef (runtime already next to niuma)"
    rm -rf "$REPO_ROOT/third_party/cef"
  fi
  if [[ -d "$REPO_ROOT/third_party/cef-cache" ]]; then
    nm_log "remove third_party/cef-cache"
    rm -rf "$REPO_ROOT/third_party/cef-cache"
  fi
fi

nm_log "CI disk after prune"
df -h "$REPO_ROOT" 2>/dev/null || df -h
