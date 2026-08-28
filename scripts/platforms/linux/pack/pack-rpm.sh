#!/usr/bin/env bash
set -euo pipefail
# 从 pack-linux.sh 产出的 deb 目录构建 RPM（需 rpmbuild 或 fpm）。
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../../shared/lib/common.sh
source "$SCRIPT_DIR/../../../shared/lib/common.sh"

REPO_ROOT="$(nm_repo_root "$SCRIPT_DIR")"
PLATFORM="linux"
ARCH="$(nm_detect_arch)"
CONFIGURATION="Release"
PACKAGE_ID="niuma"
VENDOR="NiuMa"
INSTALL_ROOT="/opt/niuma"
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --arch) ARCH="$2"; shift 2 ;;
    --configuration) CONFIGURATION="$2"; shift 2 ;;
    --package-id) PACKAGE_ID="$2"; shift 2 ;;
    --vendor) VENDOR="$2"; shift 2 ;;
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    *) nm_die "unknown argument: $1" ;;
  esac
done

nm_assert_native_matrix "$PLATFORM" "$ARCH"

[[ -n "$OUTPUT_DIR" ]] || OUTPUT_DIR="$(nm_default_output_dir "$REPO_ROOT" "$PLATFORM" "$ARCH" "rpm")"
VERSION="$(nm_package_json_value "$REPO_ROOT" ".version")"
DESCRIPTION="$(nm_package_json_value "$REPO_ROOT" ".description")"
RPM_ARCH="$(nm_deb_arch "$ARCH")"

DEB_DIR="$(nm_default_output_dir "$REPO_ROOT" "$PLATFORM" "$ARCH" "deb")"
DEB_GLOB="${PACKAGE_ID}_${VERSION}_${RPM_ARCH}"
DEB_ROOT="$DEB_DIR/${DEB_GLOB}"
DEB_FILE="$DEB_DIR/${DEB_GLOB}.deb"
if [[ ! -d "$DEB_ROOT" && -f "$DEB_FILE" ]]; then
  nm_log "extract deb tree from $DEB_FILE"
  mkdir -p "$DEB_ROOT"
  dpkg-deb -x "$DEB_FILE" "$DEB_ROOT"
  dpkg-deb -e "$DEB_FILE" "$DEB_ROOT/DEBIAN"
fi
if [[ ! -d "$DEB_ROOT" ]]; then
  nm_log "deb tree missing; running pack-linux.sh first"
  bash "$SCRIPT_DIR/pack-linux.sh" --platform "$PLATFORM" --arch "$ARCH" --configuration "$CONFIGURATION" --skip-web-build --skip-shell-build
fi
[[ -d "$DEB_ROOT" ]] || nm_die "deb staging tree not found: $DEB_ROOT"

PAYLOAD_SRC="$DEB_ROOT$INSTALL_ROOT"
[[ -d "$PAYLOAD_SRC" ]] || nm_die "payload not found under deb tree: $PAYLOAD_SRC"

mkdir -p "$OUTPUT_DIR"
RPM_FILE="$OUTPUT_DIR/${PACKAGE_ID}-${VERSION}-${RPM_ARCH}.rpm"

if command -v fpm >/dev/null 2>&1; then
  nm_log "build rpm via fpm -> $RPM_FILE"
  fpm -s dir -t rpm -n "$PACKAGE_ID" -v "$VERSION" --architecture "$RPM_ARCH" \
    --vendor "$VENDOR" --description "$DESCRIPTION" \
  -C "$PAYLOAD_SRC" --prefix "$INSTALL_ROOT" \
    --rpm-user root --rpm-group root \
    -p "$RPM_FILE" .
elif command -v rpmbuild >/dev/null 2>&1; then
  WORK="$REPO_ROOT/build/pack-rpm"
  rm -rf "$WORK"
  mkdir -p "$WORK/BUILDROOT" "$WORK/SPECS" "$WORK/SOURCES"
  tar -C "$PAYLOAD_SRC" -czf "$WORK/SOURCES/${PACKAGE_ID}-${VERSION}.tar.gz" .
  cat > "$WORK/SPECS/${PACKAGE_ID}.spec" <<EOF
Name:           $PACKAGE_ID
Version:        $VERSION
Release:        1%{?dist}
Summary:        $DESCRIPTION
License:        Proprietary
Vendor:         $VENDOR
BuildArch:      $RPM_ARCH

%description
$DESCRIPTION

%prep
%setup -q -c -T -a %{SOURCE0}

%install
mkdir -p %{buildroot}$INSTALL_ROOT
cp -a * %{buildroot}$INSTALL_ROOT/

%files
$INSTALL_ROOT

%changelog
EOF
  nm_log "build rpm via rpmbuild -> $RPM_FILE"
  rpmbuild -bb "$WORK/SPECS/${PACKAGE_ID}.spec" --define "_topdir $WORK" --define "_rpmdir $OUTPUT_DIR"
  built="$(find "$OUTPUT_DIR" -maxdepth 1 -name "${PACKAGE_ID}-${VERSION}*.rpm" -type f | head -n 1)"
  [[ -n "$built" ]] || nm_die "rpmbuild produced no rpm"
  if [[ "$built" != "$RPM_FILE" ]]; then
    mv -f "$built" "$RPM_FILE"
  fi
else
  nm_die "install fpm (gem install fpm) or rpmbuild to build RPM packages"
fi

nm_log "RPM ready -> $RPM_FILE"
