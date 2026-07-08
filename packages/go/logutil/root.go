package logutil

import (
	"os"
	"path/filepath"
)

// resolveLogDir 返回落盘目录：NIUMMA_LOG_DIR > NIUMMA_LOG_ROOT > 仓库根 logs/。
func resolveLogDir() string {
	if dir := os.Getenv("NIUMMA_LOG_DIR"); dir != "" {
		return dir
	}
	if root := os.Getenv("NIUMMA_LOG_ROOT"); root != "" {
		return root
	}
	return findRepoLogsDir()
}

func findRepoLogsDir() string {
	seen := make(map[string]struct{})
	for _, start := range logSearchRoots() {
		if start == "" {
			continue
		}
		if _, ok := seen[start]; ok {
			continue
		}
		seen[start] = struct{}{}
		if repo := findRepoRoot(start); repo != "" {
			return filepath.Join(repo, "logs")
		}
	}
	return ""
}

func logSearchRoots() []string {
	var roots []string
	if exe, err := os.Executable(); err == nil {
		roots = append(roots, filepath.Dir(exe))
	}
	if cwd, err := os.Getwd(); err == nil {
		roots = append(roots, cwd)
	}
	return roots
}

func findRepoRoot(start string) string {
	dir := start
	for i := 0; i < 12; i++ {
		if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}
