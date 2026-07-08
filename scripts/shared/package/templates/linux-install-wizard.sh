#!/usr/bin/env bash
# 由 build-deb-installer.sh 嵌入 .run 安装包；在目标机器上执行。
set -euo pipefail

APP_NAME="${NIUMMA_APP_NAME:-NiuMa}"
APP_VERSION="${NIUMMA_APP_VERSION:-0.0.0}"
DEB_FILE="$(cd "$(dirname "$0")" && pwd)/package.deb"

have_gui() {
  command -v zenity >/dev/null 2>&1
}

die_gui() {
  local msg="$1"
  if have_gui; then
    zenity --error --title="$APP_NAME Setup" --text="$msg" --width=420
  else
    printf 'ERROR: %s\n' "$msg" >&2
  fi
  exit 1
}

info_gui() {
  local msg="$1"
  if have_gui; then
    zenity --info --title="$APP_NAME Setup" --text="$msg" --width=420
  else
    printf '%s\n' "$msg"
  fi
}

question_gui() {
  local msg="$1"
  if have_gui; then
    zenity --question --title="$APP_NAME Setup" --text="$msg" --width=420
    return $?
  fi
  printf '%s [y/N] ' "$msg"
  read -r ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

[[ -f "$DEB_FILE" ]] || die_gui "Internal error: package.deb not found."

if have_gui; then
  zenity --info --title="$APP_NAME Setup" --text="Welcome to the $APP_NAME $APP_VERSION installer.\n\nThis wizard will install $APP_NAME on your system." --width=460
else
  printf '==> %s %s installer\n' "$APP_NAME" "$APP_VERSION"
fi

question_gui "Install $APP_NAME $APP_VERSION now?\n\nAdministrator privileges are required." || exit 0

if ! command -v dpkg >/dev/null 2>&1; then
  die_gui "dpkg is required but not found. This installer supports Debian/Ubuntu/Kylin derivatives."
fi

install_log="$(mktemp)"
trap 'rm -f "$install_log"' EXIT

run_install() {
  if command -v pkexec >/dev/null 2>&1; then
    pkexec dpkg -i "$DEB_FILE" >"$install_log" 2>&1
  elif command -v gksudo >/dev/null 2>&1; then
    gksudo dpkg -i "$DEB_FILE" >"$install_log" 2>&1
  else
    sudo dpkg -i "$DEB_FILE" >"$install_log" 2>&1
  fi
}

if have_gui; then
  if ! run_install >"$install_log" 2>&1; then
    log_text="$(cat "$install_log" 2>/dev/null || true)"
    die_gui "Installation failed.\n\n$log_text"
  fi
else
  run_install || die_gui "Installation failed. See output above."
fi

if command -v apt-get >/dev/null 2>&1; then
  if command -v pkexec >/dev/null 2>&1; then
    pkexec apt-get install -f -y >>"$install_log" 2>&1 || true
  else
    sudo apt-get install -f -y >>"$install_log" 2>&1 || true
  fi
fi

info_gui "$APP_NAME $APP_VERSION has been installed.\n\nYou can launch it from the application menu."
