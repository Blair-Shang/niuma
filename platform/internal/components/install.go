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

// progressEmitMinInterval 下载进度上报最小间隔，避免刷爆事件总线。
const progressEmitMinInterval = 100 * time.Millisecond

// InstallPhase 表示组件安装阶段。
const (
	InstallPhaseDownloading = "downloading"
	InstallPhaseExtracting  = "extracting"
	InstallPhaseFinalizing  = "finalizing"
)

// InstallProgress 是安装过程进度（供 UI 展示）。
type InstallProgress struct {
	BundleID      string  `json:"bundleId"`
	ToolID        string  `json:"toolId,omitempty"`
	PackageID     string  `json:"packageId,omitempty"`
	Phase         string  `json:"phase"`
	BytesReceived int64   `json:"bytesReceived,omitempty"`
	BytesTotal    int64   `json:"bytesTotal,omitempty"`
	Percent       float64 `json:"percent,omitempty"`
}

// InstallProgressFunc 接收安装进度回调；可为 nil。
type InstallProgressFunc func(InstallProgress)

// InstallPackageSpec 描述单个平台安装包。
type InstallPackageSpec struct {
	ID      string   `yaml:"id"`
	OS      string   `yaml:"os"`
	Arch    string   `yaml:"arch"`
	URL     string   `yaml:"url"`
	Archive string   `yaml:"archive"`
	BinDir  string   `yaml:"binDir"`
	// Tools 声明本包覆盖的工具 id；空则仅当 package.id == toolId 时匹配单工具安装。
	Tools []string `yaml:"tools"`
}

// BundleInstallSpec 是组件包级安装配置（Phase 4b）。
type BundleInstallSpec struct {
	Mode     string               `yaml:"mode"`
	Packages []InstallPackageSpec `yaml:"packages"`
}

// Install 下载并解压安装包至 data/components/{bundleId}/bin/。
// toolID 为空时安装当前平台全部匹配包；非空时仅安装覆盖该工具的包（支持单独重装）。
func (r *Registry) Install(ctx context.Context, bundleID, toolID string, onProgress InstallProgressFunc) (BundleStatusDTO, error) {
	m, ok := r.bundles[bundleID]
	if !ok {
		return BundleStatusDTO{}, fmt.Errorf("components: bundle not found: %s", bundleID)
	}
	if m.Install.Mode != "optional_download" {
		return BundleStatusDTO{}, fmt.Errorf("components: bundle does not support install: %s", bundleID)
	}
	toolID = strings.TrimSpace(toolID)
	if toolID != "" && !m.hasTool(toolID) {
		return BundleStatusDTO{}, fmt.Errorf("components: tool not found: %s/%s", bundleID, toolID)
	}
	pkgs := matchingPackages(m.Install.Packages, toolID)
	if len(pkgs) == 0 {
		if toolID != "" {
			return BundleStatusDTO{}, fmt.Errorf("components: no install package for tool %s on %s/%s", toolID, runtime.GOOS, runtime.GOARCH)
		}
		return BundleStatusDTO{}, fmt.Errorf("components: no install package for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	if r.bundledRoot == "" {
		return BundleStatusDTO{}, fmt.Errorf("components: install data dir unavailable")
	}

	binDir := filepath.Join(r.bundledRoot, bundleID, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return BundleStatusDTO{}, fmt.Errorf("components: mkdir bin: %w", err)
	}

	report := func(p InstallProgress) {
		if onProgress == nil {
			return
		}
		p.BundleID = bundleID
		p.ToolID = toolID
		onProgress(p)
	}

	for _, pkg := range pkgs {
		if err := r.installPackage(ctx, pkg, binDir, report); err != nil {
			return BundleStatusDTO{}, fmt.Errorf("components: install %s: %w", pkg.ID, err)
		}
	}

	report(InstallProgress{Phase: InstallPhaseFinalizing, Percent: 100})

	paths, err := r.loadPaths(ctx)
	if err != nil {
		return BundleStatusDTO{}, err
	}
	return r.bundleStatus(ctx, m, paths)
}

func matchingPackages(all []InstallPackageSpec, toolID string) []InstallPackageSpec {
	osName := normalizePlatformOS(runtime.GOOS)
	arch := normalizePlatformArch(runtime.GOARCH)
	var out []InstallPackageSpec
	for _, pkg := range all {
		if !strings.EqualFold(pkg.OS, osName) || !archMatches(pkg.Arch, arch) {
			continue
		}
		if !packageMatchesTool(pkg, toolID) {
			continue
		}
		out = append(out, pkg)
	}
	return out
}

// packageMatchesTool 判断安装包是否覆盖指定工具；toolID 为空表示整包安装。
func packageMatchesTool(pkg InstallPackageSpec, toolID string) bool {
	if toolID == "" {
		return true
	}
	if len(pkg.Tools) > 0 {
		for _, id := range pkg.Tools {
			if strings.EqualFold(strings.TrimSpace(id), toolID) {
				return true
			}
		}
		return false
	}
	// 未声明 tools 时按 package.id == toolId 匹配（如 mongosh）。
	return strings.EqualFold(strings.TrimSpace(pkg.ID), toolID)
}

// toolInstallable 报告当前平台是否存在可下载安装该工具的包。
func (m *BundleManifest) toolInstallable(toolID string) bool {
	if !m.SupportsInstall() {
		return false
	}
	return len(matchingPackages(m.Install.Packages, toolID)) > 0
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

func (r *Registry) installPackage(
	ctx context.Context,
	pkg InstallPackageSpec,
	binDir string,
	report func(InstallProgress),
) error {
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

	report(InstallProgress{
		PackageID: pkg.ID,
		Phase:     InstallPhaseDownloading,
		Percent:   0,
	})
	if err := downloadFile(ctx, url, tmpFile, func(received, total int64) {
		percent := 0.0
		if total > 0 {
			percent = float64(received) / float64(total) * 90 // 下载占 0–90%
		}
		report(InstallProgress{
			PackageID:     pkg.ID,
			Phase:         InstallPhaseDownloading,
			BytesReceived: received,
			BytesTotal:    total,
			Percent:       percent,
		})
	}); err != nil {
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	report(InstallProgress{
		PackageID: pkg.ID,
		Phase:     InstallPhaseExtracting,
		Percent:   92,
	})

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
	if err := copyBinaries(sourceBin, binDir); err != nil {
		return err
	}
	report(InstallProgress{
		PackageID: pkg.ID,
		Phase:     InstallPhaseExtracting,
		Percent:   98,
	})
	return nil
}

func downloadFile(ctx context.Context, url string, dest *os.File, onBytes func(received, total int64)) error {
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
	total := resp.ContentLength
	if total < 0 {
		total = 0
	}
	writer := &progressWriter{
		w:        dest,
		total:    total,
		onBytes:  onBytes,
		minInterval: progressEmitMinInterval,
	}
	_, err = io.Copy(writer, resp.Body)
	if err == nil && onBytes != nil {
		onBytes(writer.received, total)
	}
	return err
}

type progressWriter struct {
	w           io.Writer
	total       int64
	received    int64
	onBytes     func(received, total int64)
	minInterval time.Duration
	lastEmit    time.Time
}

func (p *progressWriter) Write(b []byte) (int, error) {
	n, err := p.w.Write(b)
	p.received += int64(n)
	if p.onBytes != nil {
		now := time.Now()
		if p.lastEmit.IsZero() || now.Sub(p.lastEmit) >= p.minInterval {
			p.onBytes(p.received, p.total)
			p.lastEmit = now
		}
	}
	return n, err
}

// safeExtractPath 将归档内相对路径解析到 dest 下，并拒绝跳出 dest 的路径穿越。
// 允许 name 为 "." / "./"（归档根目录项），此时返回 dest 本身。
func safeExtractPath(dest, name string) (string, error) {
	cleanDest := filepath.Clean(dest)
	target := filepath.Clean(filepath.Join(cleanDest, filepath.FromSlash(name)))
	if target == cleanDest {
		return target, nil
	}
	prefix := cleanDest + string(os.PathSeparator)
	if !strings.HasPrefix(target, prefix) {
		return "", fmt.Errorf("path slip: %s", name)
	}
	return target, nil
}

func extractZip(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		target, err := safeExtractPath(dest, f.Name)
		if err != nil {
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
		target, err := safeExtractPath(dest, hdr.Name)
		if err != nil {
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
