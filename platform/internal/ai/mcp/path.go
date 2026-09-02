package mcp

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// BuiltinMCPVastbaseReadonlyID 是种子迁移注册的 Vastbase 只读 MCP server_id。
const BuiltinMCPVastbaseReadonlyID = "builtin_mcp_vastbase_readonly"

// BuiltinMCPVastbaseReadonlyName 是展示名 / 稳定 server_name。
const BuiltinMCPVastbaseReadonlyName = "vastbase-readonly"

// BuiltinMCPVastbaseReadonlyCommand 是可执行文件基名（无扩展名）；运行时解析路径。
const BuiltinMCPVastbaseReadonlyCommand = "mcp-vastbase-readonly"

// envServicesBin 可覆盖 MCP / 服务二进制搜索根（如 services/bin）。
const envServicesBin = "NIUMA_SERVICES_BIN"

// resolveMCPCommandPath 解析 stdio MCP 可执行路径。
//
// 搜索顺序：绝对路径 → NIUMA_SERVICES_BIN → platform-core 旁 → 仓库 services/bin
// （含 windows-amd64 等平台子目录）→ PATH。
// 不把 MCP 业务逻辑编进 platform，仅定位外部二进制。
func resolveMCPCommandPath(commandPath string) (string, error) {
	commandPath = strings.TrimSpace(commandPath)
	if commandPath == "" {
		return "", fmt.Errorf("ai: mcp stdio commandPath required")
	}
	if filepath.IsAbs(commandPath) {
		if st, err := os.Stat(commandPath); err == nil && !st.IsDir() {
			return commandPath, nil
		}
		return commandPath, nil
	}

	base := filepath.Base(commandPath)
	names := candidateBinaryNames(base)
	for _, dir := range mcpSearchDirs() {
		for _, name := range names {
			cand := filepath.Clean(filepath.Join(dir, name))
			if st, err := os.Stat(cand); err == nil && !st.IsDir() {
				return cand, nil
			}
		}
	}
	for _, name := range names {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf(
		"ai: mcp binary not found: %s (set %s, place under services/bin, next to platform-core, or on PATH)",
		base, envServicesBin,
	)
}

func candidateBinaryNames(base string) []string {
	names := []string{base}
	if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(base), ".exe") {
		names = append(names, base+".exe")
	}
	return names
}

func mcpSearchDirs() []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(dir string) {
		dir = filepath.Clean(strings.TrimSpace(dir))
		if dir == "" || dir == "." {
			return
		}
		if _, ok := seen[dir]; ok {
			return
		}
		seen[dir] = struct{}{}
		out = append(out, dir)
	}

	if v := strings.TrimSpace(os.Getenv(envServicesBin)); v != "" {
		add(v)
		add(filepath.Join(v, platformArchDir()))
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		add(dir)
		add(filepath.Join(dir, "bin"))
		add(filepath.Join(dir, "..", "bin"))
		add(filepath.Join(dir, "..", "services", "bin"))
		add(filepath.Join(dir, "..", "services", "bin", platformArchDir()))
	}
	if cwd, err := os.Getwd(); err == nil {
		add(cwd)
		add(filepath.Join(cwd, "bin"))
		add(filepath.Join(cwd, "services", "bin"))
		add(filepath.Join(cwd, "services", "bin", platformArchDir()))
		// go run / 调试时常从 platform/ 启动
		add(filepath.Join(cwd, "..", "services", "bin"))
		add(filepath.Join(cwd, "..", "services", "bin", platformArchDir()))
		// 向上最多 4 层找仓库根下的 services/bin
		cur := cwd
		for i := 0; i < 4; i++ {
			parent := filepath.Dir(cur)
			if parent == cur {
				break
			}
			cur = parent
			add(filepath.Join(cur, "services", "bin"))
			add(filepath.Join(cur, "services", "bin", platformArchDir()))
		}
	}
	return out
}

func platformArchDir() string {
	goos := runtime.GOOS
	arch := runtime.GOARCH
	switch arch {
	case "amd64":
		// keep
	case "arm64":
		// keep
	default:
		return goos + "-" + arch
	}
	if goos == "windows" {
		return "windows-" + arch
	}
	if goos == "darwin" {
		return "darwin-" + arch
	}
	if goos == "linux" {
		return "linux-" + arch
	}
	return goos + "-" + arch
}
