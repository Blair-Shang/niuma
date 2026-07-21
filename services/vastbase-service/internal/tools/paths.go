// Package tools 管理 vb_dump / vb_restore / vsql 等原生客户端工具任务。
package tools

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	vastbaseToolsBundleID      = "com.niuma.components.vastbase-tools"
	postgresqlClientBundleID   = "com.niuma.components.postgresql-client"
)

// PathOverrides 是请求级工具路径覆盖。
type PathOverrides map[string]string

// toolExecutables 按工具 ID 列出 PATH / 组件包候选名（含 openGauss 别名）。
var toolExecutables = map[string][]string{
	"vb_dump":    {"vb_dump", "gs_dump"},
	"vb_restore": {"vb_restore", "gs_restore"},
	"vsql":       {"vsql", "gsql"},
	"pg_dump":    {"pg_dump"},
	"pg_restore": {"pg_restore"},
	"psql":       {"psql"},
}

var toolBundleIDs = map[string]string{
	"vb_dump":    vastbaseToolsBundleID,
	"vb_restore": vastbaseToolsBundleID,
	"vsql":       vastbaseToolsBundleID,
	"pg_dump":    postgresqlClientBundleID,
	"pg_restore": postgresqlClientBundleID,
	"psql":       postgresqlClientBundleID,
}

// DetectResult 是单个工具探测结果。
type DetectResult struct {
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
}

// ResolvePath 按请求覆盖 → 组件包目录 → PATH 解析可执行文件。
func ResolvePath(toolID string, requestPaths PathOverrides) (string, bool) {
	if p := strings.TrimSpace(requestPaths[toolID]); p != "" && fileExists(p) {
		return p, true
	}
	if p, ok := resolveBundled(toolID); ok {
		return p, true
	}
	for _, name := range toolExecutables[toolID] {
		if p, err := exec.LookPath(name); err == nil {
			return p, true
		}
	}
	return "", false
}

// Detect 探测单个工具。
func Detect(toolID string, requestPaths PathOverrides) DetectResult {
	path, ok := ResolvePath(toolID, requestPaths)
	if !ok {
		return DetectResult{Available: false}
	}
	return DetectResult{
		Available: true,
		Path:      path,
		Version:   probeVersion(path),
	}
}

func resolveBundled(toolID string) (string, bool) {
	dataDir := userDataDir()
	if dataDir == "" {
		return "", false
	}
	bundleID := toolBundleIDs[toolID]
	if bundleID == "" {
		return "", false
	}
	for _, name := range toolExecutables[toolID] {
		base := filepath.Join(dataDir, "components", bundleID, "bin", name)
		if fileExists(base) {
			return base, true
		}
		if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(name), ".exe") {
			exe := base + ".exe"
			if fileExists(exe) {
				return exe, true
			}
		}
	}
	return "", false
}

func userDataDir() string {
	if runtime.GOOS == "windows" {
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			return filepath.Join(local, "NiuMa", "data")
		}
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".niuma", "data")
	}
	return ""
}

func probeVersion(exe string) string {
	cmd := exec.Command(exe, "--version")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(string(out))
	if idx := strings.IndexByte(line, '\n'); idx >= 0 {
		line = strings.TrimSpace(line[:idx])
	}
	if len(line) > 200 {
		line = line[:200]
	}
	return line
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
