package components

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const versionProbeTimeout = 3 * time.Second

// probeVersion 执行 `<exe> --version`（或 manifest 指定参数）并返回首行文本。
func probeVersion(ctx context.Context, exe string, versionArgs []string) string {
	if len(versionArgs) == 0 {
		versionArgs = []string{"--version"}
	}
	args := append([]string{}, versionArgs...)
	runCtx, cancel := context.WithTimeout(ctx, versionProbeTimeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, exe, args...)
	cmd.Env = os.Environ()
	out, err := cmd.CombinedOutput()
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

// findOnPath 按 manifest 中的可执行名在 PATH 中查找。
func findOnPath(executables []string) (path string, ok bool) {
	for _, name := range executables {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if p, err := exec.LookPath(name); err == nil {
			return p, true
		}
	}
	return "", false
}

// bundledPath 返回可选组件包安装目录下的候选路径。
func bundledPath(bundledRoot, bundleID, executableName string) string {
	if bundledRoot == "" || bundleID == "" || executableName == "" {
		return ""
	}
	base := filepath.Join(bundledRoot, bundleID, "bin", executableName)
	if fileExists(base) {
		return base
	}
	if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(executableName), ".exe") {
		exe := base + ".exe"
		if fileExists(exe) {
			return exe
		}
	}
	return filepath.Join(bundledRoot, bundleID, "bin", executableName)
}

// fileExists 报告路径是否为存在的普通文件。
func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
