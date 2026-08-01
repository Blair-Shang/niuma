// Package tools 管理本机 clickhouse-client 外部任务（不编进服务二进制）。
package tools

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const clickhouseToolsBundleID = "com.niuma.components.clickhouse-tools"

// PathOverrides 是请求级工具路径覆盖。
type PathOverrides map[string]string

var toolExecutables = map[string][]string{
	"clickhouse-client": {"clickhouse-client", "clickhouse"},
}

var toolBundleIDs = map[string]string{
	"clickhouse-client": clickhouseToolsBundleID,
}

// DetectResult 是单个工具探测结果。
type DetectResult struct {
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
}

// DetectAllResult 是 tools.detect 返回。
type DetectAllResult struct {
	ClickHouseClient DetectResult `json:"clickhouseClient"`
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

// DetectAll 探测 clickhouse-client。
func DetectAll(requestPaths PathOverrides) DetectAllResult {
	return DetectAllResult{
		ClickHouseClient: Detect("clickhouse-client", requestPaths),
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
		// 部分发行版用 clickhouse client --version
		cmd2 := exec.Command(exe, "client", "--version")
		out2, err2 := cmd2.CombinedOutput()
		if err2 != nil {
			return ""
		}
		out = out2
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
