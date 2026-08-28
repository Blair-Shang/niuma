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

agree_eula() {
  local dir
  dir="$(cd "$(dirname "$0")" && pwd)"
  local eula="$dir/EULA.en-US.txt"
  case "${LANG:-}" in
    zh*|ZH*) eula="$dir/EULA.zh-CN.txt" ;;
  esac
  [[ -f "$eula" ]] || eula="$dir/EULA.zh-CN.txt"
  [[ -f "$eula" ]] || return 0

  if have_gui && zenity --help 2>&1 | grep -q -- '--text-info'; then
    zenity --text-info --title="$APP_NAME License" --filename="$eula" --width=640 --height=480 \
      --checkbox="I have read and agree to the terms / 我已阅读并同意" || return 1
    return 0
  fi
  if have_gui; then
    question_gui "You must accept the NiuMa EULA to continue.\nSee licenses after install, or the text in this package.\n\nAgree and continue?" || return 1
    return 0
  fi
  printf '\n===== EULA =====\n'
  cat "$eula"
  printf '\n'
  question_gui "Agree to the EULA?"
}

[[ -f "$DEB_FILE" ]] || die_gui "Internal error: package.deb not found."

if have_gui; then
  zenity --info --title="$APP_NAME Setup" --text="Welcome to the $APP_NAME $APP_VERSION installer.\n\nThis wizard will install $APP_NAME on your system." --width=460
else
  printf '==> %s %s installer\n' "$APP_NAME" "$APP_VERSION"
fi

agree_eula || exit 0

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
