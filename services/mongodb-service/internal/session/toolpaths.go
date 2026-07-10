package session

import (
	"os"
	"os/exec"
	"strings"
)

// ToolPathOverrides 是连接级或请求级工具路径覆盖。
type ToolPathOverrides map[string]string

var toolExecutables = map[string][]string{
	"mongosh":       {"mongosh", "mongo"},
	"mongodump":     {"mongodump"},
	"mongorestore":  {"mongorestore"},
	"mongoexport":   {"mongoexport"},
	"mongoimport":   {"mongoimport"},
}

// ResolveToolPath 按连接 tool_paths → 请求 toolPaths → PATH 顺序解析可执行文件。
func ResolveToolPath(toolID string, connPaths, requestPaths ToolPathOverrides) (path string, ok bool) {
	if p := strings.TrimSpace(connPaths[toolID]); p != "" && fileExists(p) {
		return p, true
	}
	if p := strings.TrimSpace(requestPaths[toolID]); p != "" && fileExists(p) {
		return p, true
	}
	for _, name := range toolExecutables[toolID] {
		if p, err := exec.LookPath(name); err == nil {
			return p, true
		}
	}
	return "", false
}

// ToolDetectResult 是单个工具的探测结果。
type ToolDetectResult struct {
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
}

// DetectTool 探测指定工具是否可用。
func DetectTool(toolID string, connPaths, requestPaths ToolPathOverrides) ToolDetectResult {
	path, ok := ResolveToolPath(toolID, connPaths, requestPaths)
	if !ok {
		return ToolDetectResult{Available: false}
	}
	return ToolDetectResult{
		Available: true,
		Path:      path,
		Version:   probeToolVersion(path),
	}
}

func probeToolVersion(exe string) string {
	ctx := exec.Command(exe, "--version")
	ctx.Env = os.Environ()
	out, err := ctx.CombinedOutput()
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(string(out))
	if line == "" {
		return ""
	}
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
