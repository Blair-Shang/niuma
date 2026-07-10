// Package components 加载工具组件包 manifest，并探测本机第三方 CLI 路径。
package components

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// ToolDetectSpec 描述如何在 PATH 或固定目录中定位可执行文件。
type ToolDetectSpec struct {
	Executables []string `yaml:"executables"`
	VersionArgs []string `yaml:"versionArgs"`
}

// ToolInstallSpec 描述安装/下载策略（Phase 4a 仅使用 downloadPage）。
type ToolInstallSpec struct {
	Mode         string `yaml:"mode"`
	DownloadPage string `yaml:"downloadPage"`
}

// ToolSpec 是组件包内单个工具的声明。
type ToolSpec struct {
	ID          string           `yaml:"id"`
	DisplayName string           `yaml:"displayName"`
	Detect      ToolDetectSpec   `yaml:"detect"`
	Install     ToolInstallSpec  `yaml:"install"`
}

// BundleManifest 对应 components/<name>/manifest.yaml。
type BundleManifest struct {
	ID      string            `yaml:"id"`
	Name    string            `yaml:"name"`
	Module  string            `yaml:"module"`
	Install BundleInstallSpec `yaml:"install"`
	Tools   []ToolSpec        `yaml:"tools"`
}

// LoadBundleManifests 从 componentsDir 下各子目录读取 manifest.yaml。
func LoadBundleManifests(componentsDir string) (map[string]*BundleManifest, error) {
	entries, err := os.ReadDir(componentsDir)
	if err != nil {
		return nil, fmt.Errorf("components: read dir %q: %w", componentsDir, err)
	}

	out := make(map[string]*BundleManifest)
	for _, ent := range entries {
		if !ent.IsDir() {
			continue
		}
		path := filepath.Join(componentsDir, ent.Name(), "manifest.yaml")
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			if os.IsNotExist(readErr) {
				continue
			}
			return nil, fmt.Errorf("components: read %s: %w", path, readErr)
		}
		var m BundleManifest
		if err := yaml.Unmarshal(raw, &m); err != nil {
			return nil, fmt.Errorf("components: parse %s: %w", path, err)
		}
		if m.ID == "" {
			return nil, fmt.Errorf("components: missing id in %s", path)
		}
		out[m.ID] = &m
	}
	return out, nil
}

// ResolveDir 从当前可执行文件向上查找含 components/ 子目录的根路径。
func ResolveDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("components: resolve executable: %w", err)
	}
	dir := filepath.Dir(exe)
	for i := 0; i < 8; i++ {
		candidate := filepath.Join(dir, "components")
		if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
			return candidate, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("components: directory not found near %s", exe)
}

// SettingsKey 是全局工具路径在 nm_app_setting 中的键名。
const SettingsKey = "components.tool_paths"

// ToolStatus 枚举：与 Web ToolComponentStatus.status 对齐。
const (
	ToolStatusMissing    = "missing"
	ToolStatusDetected   = "detected"
	ToolStatusConfigured = "configured"
	ToolStatusBundled    = "bundled"
)

// executableBase 去掉路径与扩展名，便于跨平台比较。
func executableBase(name string) string {
	base := filepath.Base(name)
	return strings.TrimSuffix(base, filepath.Ext(base))
}
