package components

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const installHTTPTimeout = 10 * time.Minute

// InstallPackageSpec 描述单个平台安装包。
type InstallPackageSpec struct {
	ID      string `yaml:"id"`
	OS      string `yaml:"os"`
	Arch    string `yaml:"arch"`
	URL     string `yaml:"url"`
	Archive string `yaml:"archive"`
	BinDir  string `yaml:"binDir"`
}

// BundleInstallSpec 是组件包级安装配置（Phase 4b）。
type BundleInstallSpec struct {
	Mode     string               `yaml:"mode"`
	Packages []InstallPackageSpec `yaml:"packages"`
}

// Install 下载并解压 manifest 中当前平台匹配的安装包至 data/components/{bundleId}/bin/。
func (r *Registry) Install(ctx context.Context, bundleID string) (BundleStatusDTO, error) {
	m, ok := r.bundles[bundleID]
	if !ok {
		return BundleStatusDTO{}, fmt.Errorf("components: bundle not found: %s", bundleID)
	}
	if m.Install.Mode != "optional_download" {
		return BundleStatusDTO{}, fmt.Errorf("components: bundle does not support install: %s", bundleID)
	}
	pkgs := matchingPackages(m.Install.Packages)
	if len(pkgs) == 0 {
		return BundleStatusDTO{}, fmt.Errorf("components: no install package for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	if r.bundledRoot == "" {
		return BundleStatusDTO{}, fmt.Errorf("components: install data dir unavailable")
	}

	binDir := filepath.Join(r.bundledRoot, bundleID, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return BundleStatusDTO{}, fmt.Errorf("components: mkdir bin: %w", err)
	}

	for _, pkg := range pkgs {
		if err := r.installPackage(ctx, pkg, binDir); err != nil {
			return BundleStatusDTO{}, fmt.Errorf("components: install %s: %w", pkg.ID, err)
		}
	}

	paths, err := r.loadPaths(ctx)
	if err != nil {
		return BundleStatusDTO{}, err
	}
	return r.bundleStatus(ctx, m, paths)
}

func matchingPackages(all []InstallPackageSpec) []InstallPackageSpec {
	osName := normalizePlatformOS(runtime.GOOS)
	arch := normalizePlatformArch(runtime.GOARCH)
	var out []InstallPackageSpec
	for _, pkg := range all {
		if strings.EqualFold(pkg.OS, osName) && archMatches(pkg.Arch, arch) {
			out = append(out, pkg)
		}
	}
	return out
}

func normalizePlatformOS(goos string) string {
	switch goos {
	case "windows":
		return "windows"
	case "darwin":
		return "darwin"
	default:
		return "linux"
	}
}

func normalizePlatformArch(goarch string) string {
	switch goarch {
	case "arm64":
		return "arm64"
	default:
		return "amd64"
	}
}

func archMatches(specArch, runtimeArch string) bool {
	specArch = strings.ToLower(strings.TrimSpace(specArch))
	if specArch == "" || specArch == "all" {
		return true
	}
	if specArch == "x86_64" || specArch == "amd64" {
		return runtimeArch == "amd64"
	}
	if specArch == "aarch64" || specArch == "arm64" {
		return runtimeArch == "arm64"
	}
	return strings.EqualFold(specArch, runtimeArch)
}

func (r *Registry) installPackage(ctx context.Context, pkg InstallPackageSpec, binDir string) error {
	url := strings.TrimSpace(pkg.URL)
	if url == "" {
		return fmt.Errorf("empty download url")
	}
	tmpFile, err := os.CreateTemp("", "niuma-component-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)
	defer tmpFile.Close()

	if err := downloadFile(ctx, url, tmpFile); err != nil {
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	extractRoot, err := os.MkdirTemp("", "niuma-component-extract-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(extractRoot)

	switch strings.ToLower(strings.TrimSpace(pkg.Archive)) {
	case "zip", "":
		if err := extractZip(tmpPath, extractRoot); err != nil {
			return err
		}
	case "tar.gz", "tgz":
		if err := extractTarGz(tmpPath, extractRoot); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported archive: %s", pkg.Archive)
	}

	sourceBin := filepath.Join(extractRoot, filepath.FromSlash(strings.Trim(pkg.BinDir, "/\\")))
	return copyBinaries(sourceBin, binDir)
}

func downloadFile(ctx context.Context, url string, dest *os.File) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: installHTTPTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	_, err = io.Copy(dest, resp.Body)
	return err
}

func extractZip(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		target := filepath.Join(dest, f.Name)
		if !strings.HasPrefix(filepath.Clean(target), filepath.Clean(dest)+string(os.PathSeparator)) {
			return fmt.Errorf("zip slip: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode()|0o111)
		if err != nil {
			rc.Close()
			return err
		}
		_, copyErr := io.Copy(out, rc)
		out.Close()
		rc.Close()
		if copyErr != nil {
			return copyErr
		}
	}
	return nil
}

func extractTarGz(src, dest string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		target := filepath.Join(dest, hdr.Name)
		if !strings.HasPrefix(filepath.Clean(target), filepath.Clean(dest)+string(os.PathSeparator)) {
			return fmt.Errorf("tar slip: %s", hdr.Name)
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			mode := os.FileMode(hdr.Mode)
			if mode&0o111 != 0 || !strings.Contains(filepath.Base(target), ".") {
				mode |= 0o111
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		}
	}
}

func copyBinaries(sourceDir, destDir string) error {
	info, err := os.Stat(sourceDir)
	if err != nil {
		return fmt.Errorf("bin dir not found: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("bin dir is not a directory")
	}
	entries, err := os.ReadDir(sourceDir)
	if err != nil {
		return err
	}
	for _, ent := range entries {
		if ent.IsDir() {
			continue
		}
		src := filepath.Join(sourceDir, ent.Name())
		dst := filepath.Join(destDir, ent.Name())
		if err := copyFile(src, dst); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Chmod(0o755)
}

// SupportsInstall 报告组件包是否声明了可选下载安装。
func (m *BundleManifest) SupportsInstall() bool {
	return m.Install.Mode == "optional_download" && len(m.Install.Packages) > 0
}
