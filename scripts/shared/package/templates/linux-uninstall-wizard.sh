#!/usr/bin/env bash
# 由 build-installer.sh 嵌入 .run 卸载包；在目标机器上执行。
set -euo pipefail

APP_NAME="${NIUMMA_APP_NAME:-NiuMa}"
APP_VERSION="${NIUMMA_APP_VERSION:-0.0.0}"
PACKAGE_ID="${NIUMMA_PACKAGE_ID:-__PACKAGE_ID__}"

have_gui() {
  command -v zenity >/dev/null 2>&1
}

die_gui() {
  local msg="$1"
  if have_gui; then
    zenity --error --title="$APP_NAME Uninstall" --text="$msg" --width=420
  else
    printf 'ERROR: %s\n' "$msg" >&2
  fi
  exit 1
}

question_gui() {
  local msg="$1"
  if have_gui; then
    zenity --question --title="$APP_NAME Uninstall" --text="$msg" --width=420
    return $?
  fi
  printf '%s [y/N] ' "$msg"
  read -r ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

if ! command -v dpkg >/dev/null 2>&1; then
  die_gui "dpkg is required but not found."
fi

if ! dpkg -l "$PACKAGE_ID" >/dev/null 2>&1; then
  die_gui "$APP_NAME is not installed (package: $PACKAGE_ID)."
fi

question_gui "Remove $APP_NAME $APP_VERSION from this system?\n\nAdministrator privileges are required." || exit 0

run_remove() {
  if command -v pkexec >/dev/null 2>&1; then
    pkexec dpkg -r "$PACKAGE_ID"
  else
    sudo dpkg -r "$PACKAGE_ID"
  fi
}

if run_remove; then
  if have_gui; then
    zenity --info --title="$APP_NAME Uninstall" --text="$APP_NAME has been removed." --width=420
  else
    printf '==> %s uninstalled\n' "$APP_NAME"
  fi
else
  die_gui "Uninstall failed."
fi
