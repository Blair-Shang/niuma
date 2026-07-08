#!/usr/bin/env bash
set -euo pipefail

nm_script_dir() {
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd
}

nm_repo_root() {
  local dir="${1:-$(pwd)}"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/package.json" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  echo "failed to locate repo root (package.json not found)" >&2
  return 1
}

nm_log() {
  printf '==> %s\n' "$*"
}

nm_warn() {
  printf 'WARN: %s\n' "$*" >&2
}

nm_die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

nm_require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || nm_die "missing command: $cmd"
}

nm_package_json_value() {
  local repo_root="$1"
  local key="$2"
  nm_require_cmd node
  (cd "$repo_root" && node -p "require('./package.json')$key")
}

nm_detect_arch() {
  local raw
  raw="$(uname -m)"
  case "$raw" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    i386|i686|x86) echo "x86" ;;
    *) echo "$raw" ;;
  esac
}

nm_detect_platform() {
  local kernel
  kernel="$(uname -s)"
  case "$kernel" in
    Darwin) echo "macos" ;;
    Linux)
      if [[ -f /etc/os-release ]] && grep -Eiq 'kylin' /etc/os-release; then
        echo "kylin"
      else
        echo "linux"
      fi
      ;;
    *)
      nm_die "unsupported platform kernel: $kernel"
      ;;
  esac
}

nm_default_output_dir() {
  local repo_root="$1"
  local platform="$2"
  local arch="$3"
  local flavor="$4"
  printf '%s/output/%s-%s/%s\n' "$repo_root" "$platform" "$arch" "$flavor"
}

nm_deb_arch() {
  local arch="$1"
  case "$arch" in
    x64) echo "amd64" ;;
    arm64) echo "arm64" ;;
    x86) echo "i386" ;;
    *) echo "$arch" ;;
  esac
}

nm_services_bin_dir() {
  printf '%s/services/bin/%s-%s\n' "$1" "$2" "$3"
}

nm_shell_build_dir() {
  printf '%s/build/shell-%s-%s\n' "$1" "$2" "$3"
}

nm_shell_exe_path() {
  local repo_root="$1"
  local platform="$2"
  local arch="$3"
  local configuration="${4:-Release}"
  local build_dir config_lower
  build_dir="$(nm_shell_build_dir "$repo_root" "$platform" "$arch")"
  if [[ "$platform" == "windows" ]]; then
    printf '%s/%s/niuma.exe\n' "$build_dir" "$configuration"
    return
  fi
  config_lower="$(printf '%s' "$configuration" | tr '[:upper:]' '[:lower:]')"
  if [[ -f "$build_dir/niuma" ]]; then
    printf '%s/niuma\n' "$build_dir"
  elif [[ -f "$build_dir/$config_lower/niuma" ]]; then
    printf '%s/%s/niuma\n' "$build_dir" "$config_lower"
  else
    printf '%s/niuma\n' "$build_dir"
  fi
}

nm_shell_install_dir() {
  dirname "$(nm_shell_exe_path "$@")"
}

nm_should_sync_legacy_shell() {
  [[ "$1" == "windows" && "$2" == "$(nm_detect_arch)" ]]
}

nm_sync_legacy_shell() {
  local repo_root="$1"
  local platform="$2"
  local arch="$3"
  local configuration="${4:-Release}"
  local install_dir legacy_dir
  if ! nm_should_sync_legacy_shell "$platform" "$arch"; then
    return 0
  fi
  install_dir="$(nm_shell_install_dir "$repo_root" "$platform" "$arch" "$configuration")"
  [[ -d "$install_dir" ]] || return 0
  legacy_dir="$repo_root/build/shell/$configuration"
  mkdir -p "$legacy_dir"
  cp -R "$install_dir/." "$legacy_dir/"
  nm_log "legacy shell synced -> $legacy_dir"
}

nm_cef_index_platform() {
  local platform="$1"
  local arch="$2"
  case "$platform:$arch" in
    linux:x64|kylin:x64) echo "linux64" ;;
    linux:arm64|kylin:arm64) echo "linuxarm64" ;;
    macos:x64) echo "macosx64" ;;
    macos:arm64) echo "macosarm64" ;;
    windows:x64) echo "windows64" ;;
    windows:arm64) echo "windowsarm64" ;;
    *) nm_die "unsupported CEF platform matrix: $platform-$arch" ;;
  esac
}

nm_cef_root() {
  local repo_root="$1"
  printf '%s/third_party/cef\n' "$repo_root"
}

nm_assert_native_matrix() {
  local platform="$1"
  local arch="$2"
  local host_platform host_arch
  host_platform="$(nm_detect_platform)"
  host_arch="$(nm_detect_arch)"

  case "$platform" in
    windows)
      [[ "$host_platform" == "windows" ]] || nm_die "native build only: $platform-$arch requires Windows host (current: $host_platform-$host_arch)"
      ;;
    macos)
      [[ "$host_platform" == "macos" ]] || nm_die "native build only: $platform-$arch requires macOS host (current: $host_platform-$host_arch)"
      ;;
    linux|kylin)
      [[ "$host_platform" == "linux" || "$host_platform" == "kylin" ]] || \
        nm_die "native build only: $platform-$arch requires Linux host (current: $host_platform-$host_arch)"
      ;;
    *)
      nm_die "unsupported platform: $platform"
      ;;
  esac

  [[ "$arch" == "$host_arch" ]] || \
    nm_die "native build only: requested arch $arch but host arch is $host_arch"
}

nm_emit_build_info() {
  local repo_root="$1"
  node "$repo_root/scripts/shared/version/emit-build-info.mjs" >/dev/null
}

nm_build_info_value() {
  local repo_root="$1"
  local key="$2"
  nm_require_cmd node
  node -p "JSON.parse(require('fs').readFileSync('$repo_root/build/version.json','utf8'))$key"
}

nm_go_ldflags() {
  local configuration="${1:-Release}"
  local repo_root="$2"
  nm_emit_build_info "$repo_root"
  local version build_id build_date strip inject
  version="$(nm_build_info_value "$repo_root" ".version")"
  build_id="$(nm_build_info_value "$repo_root" ".buildId")"
  build_date="$(nm_build_info_value "$repo_root" ".buildDate")"
  strip=""
  if [[ "$configuration" == "Release" ]]; then
    strip="-s -w"
  fi
  inject="-X niuma/pkg/buildinfo.Version=$version -X niuma/pkg/buildinfo.BuildID=$build_id -X niuma/pkg/buildinfo.BuildDate=$build_date"
  if [[ -n "$strip" ]]; then
    printf '%s %s\n' "$strip" "$inject"
  else
    printf '%s\n' "$inject"
  fi
}

nm_cmake_version_args() {
  local repo_root="$1"
  nm_emit_build_info "$repo_root"
  local version build_id
  version="$(nm_build_info_value "$repo_root" ".version")"
  build_id="$(nm_build_info_value "$repo_root" ".buildId")"
  printf -- '-DNIUMMA_APP_VERSION=%s -DNIUMMA_BUILD_ID=%s\n' "$version" "$build_id"
}
