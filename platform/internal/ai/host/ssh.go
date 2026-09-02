package host

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	maxSSHFileBytes    = 12 * 1024
	maxSSHExecOutBytes = 12 * 1024
	maxSSHMetricDisks  = 8
	maxSSHMetricProcs  = 8
	defaultSSHListPath = "."
)

type sshScope struct {
	ProfileID string
	SessionID string
	ModuleID  string
	Path      string
	Command   string
	PID       int64
}

func parseSSHScope(args map[string]any) sshScope {
	s := sshScope{}
	s.ProfileID, _ = args["profileId"].(string)
	s.SessionID, _ = args["sessionId"].(string)
	s.ModuleID, _ = args["moduleId"].(string)
	s.Path, _ = args["path"].(string)
	if s.Path == "" {
		if cwd, ok := args["cwd"].(string); ok {
			s.Path = cwd
		}
	}
	s.Command, _ = args["command"].(string)
	s.ProfileID = strings.TrimSpace(s.ProfileID)
	s.SessionID = strings.TrimSpace(s.SessionID)
	s.ModuleID = strings.TrimSpace(s.ModuleID)
	s.Path = strings.TrimSpace(s.Path)
	s.Command = strings.TrimSpace(s.Command)
	s.PID = intFromAny(args["pid"])
	if s.ModuleID == "" {
		s.ModuleID = "ssh"
	}
	return s
}

func intFromAny(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int:
		return int64(n)
	case int64:
		return n
	default:
		return 0
	}
}

func (s sshScope) requireSession() error {
	if s.SessionID == "" {
		return fmt.Errorf("sessionId required (connect the SSH tab)")
	}
	return nil
}

func (s sshScope) baseParams() map[string]any {
	return map[string]any{"sessionId": s.SessionID}
}

func (s sshScope) asScope() scopeArgs {
	return scopeArgs{ProfileID: s.ProfileID, SessionID: s.SessionID, ModuleID: s.ModuleID}
}

func resolveSSHNS(ctx context.Context, rt Runtime, s sshScope) (string, error) {
	ns, err := resolveNS(ctx, rt, s.asScope())
	if err != nil {
		return "", err
	}
	if ns != "ssh" {
		return "", fmt.Errorf("ssh host: connection kind %q is not ssh", ns)
	}
	return ns, nil
}

// SSHToolSpecs 返回官方 SSH 工具列表（与 UI 同 Bridge：ssh.* → ssh-service）。
func SSHToolSpecs() []ToolSpec {
	scope := map[string]any{
		"profileId": map[string]any{"type": "string", "description": "NiuMa SSH connection profile id"},
		"sessionId": map[string]any{"type": "string", "description": "Active SSH session id from the open tab"},
	}
	schemaProps := func(extra map[string]any) map[string]any {
		out := make(map[string]any, len(scope)+len(extra))
		for k, v := range scope {
			out[k] = v
		}
		for k, v := range extra {
			out[k] = v
		}
		return out
	}
	return []ToolSpec{
		{
			Name:        ToolSSHListDir,
			Description: "List a remote SFTP directory on the current SSH session (read-only).",
			Parameters: objectSchema(schemaProps(map[string]any{
				"path": map[string]any{"type": "string", "description": "Remote directory, default current SFTP cwd or ."},
			}), nil),
			Risk:     "read",
			ServerID: ServerIDSSH,
		},
		{
			Name:        ToolSSHReadFile,
			Description: "Read a remote text file via SFTP (read-only; large files are truncated).",
			Parameters: objectSchema(schemaProps(map[string]any{
				"path": map[string]any{"type": "string", "description": "Remote file path"},
			}), []string{"path"}),
			Risk:     "read",
			ServerID: ServerIDSSH,
		},
		{
			Name:        ToolSSHHostMetrics,
			Description: "Collect remote host metrics (CPU, memory, disks, top processes). Read-only.",
			Parameters:  objectSchema(schemaProps(nil), nil),
			Risk:        "read",
			ServerID:    ServerIDSSH,
		},
		{
			Name:        ToolSSHInspectProcess,
			Description: "Inspect one remote process (cmdline, cwd, rss). Read-only.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"pid": map[string]any{"type": "integer", "description": "Process id"},
			}), []string{"pid"}),
			Risk:     "read",
			ServerID: ServerIDSSH,
		},
		{
			Name:        ToolSSHExec,
			Description: "Run a short non-interactive command on the current SSH session. Requires user confirmation. Do not run editors, pagers, or long-lived interactive programs.",
			Parameters: objectSchema(schemaProps(map[string]any{
				"command": map[string]any{"type": "string", "description": "Remote shell command"},
			}), []string{"command"}),
			Risk:     "dangerous",
			ServerID: ServerIDSSH,
		},
	}
}

// CallSSH 执行官方 ssh_* 工具：只转到已有 ssh-service Bridge，不自建连接。
func CallSSH(ctx context.Context, rt Runtime, name string, args map[string]any) (string, error) {
	if args == nil {
		args = map[string]any{}
	}
	s := parseSSHScope(args)
	switch name {
	case ToolSSHListDir:
		return sshListDir(ctx, rt, s)
	case ToolSSHReadFile:
		return sshReadFile(ctx, rt, s)
	case ToolSSHHostMetrics:
		return sshHostMetrics(ctx, rt, s)
	case ToolSSHInspectProcess:
		return sshInspectProcess(ctx, rt, s)
	case ToolSSHExec:
		return sshExec(ctx, rt, s)
	default:
		return "", fmt.Errorf("unknown host tool: %s", name)
	}
}

func sshListDir(ctx context.Context, rt Runtime, s sshScope) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	ns, err := resolveSSHNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	path := s.Path
	if path == "" {
		path = defaultSSHListPath
	}
	params := s.baseParams()
	params["path"] = path
	var result struct {
		Path    string `json:"path"`
		Entries []struct {
			Name        string `json:"name"`
			Kind        string `json:"kind"`
			Size        int64  `json:"size"`
			ModifiedAt  string `json:"modifiedAt"`
			Permissions string `json:"permissions"`
		} `json:"entries"`
	}
	if err := invokeJSON(ctx, rt, ns+".sftp.dir.list", params, &result); err != nil {
		return "", err
	}
	return indentJSON(map[string]any{
		"path":    result.Path,
		"entries": result.Entries,
		"count":   len(result.Entries),
	})
}

func sshReadFile(ctx context.Context, rt Runtime, s sshScope) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	if s.Path == "" {
		return "", fmt.Errorf("path required")
	}
	ns, err := resolveSSHNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	params := s.baseParams()
	params["path"] = s.Path
	var result struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		Size    int64  `json:"size"`
	}
	if err := invokeJSON(ctx, rt, ns+".sftp.file.read", params, &result); err != nil {
		return "", err
	}
	content, truncated := truncateBytesKeepUTF8(result.Content, maxSSHFileBytes)
	outPath := result.Path
	if outPath == "" {
		outPath = s.Path
	}
	return indentJSON(map[string]any{
		"path":      outPath,
		"content":   content,
		"size":      result.Size,
		"truncated": truncated,
	})
}

func sshHostMetrics(ctx context.Context, rt Runtime, s sshScope) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	ns, err := resolveSSHNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	var raw map[string]any
	if err := invokeJSON(ctx, rt, ns+".monitor.metrics", s.baseParams(), &raw); err != nil {
		return "", err
	}
	return indentJSON(summarizeSSHMetrics(raw))
}

func sshInspectProcess(ctx context.Context, rt Runtime, s sshScope) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	if s.PID <= 0 {
		return "", fmt.Errorf("positive pid required")
	}
	ns, err := resolveSSHNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	params := s.baseParams()
	params["pid"] = s.PID
	var result map[string]any
	if err := invokeJSON(ctx, rt, ns+".monitor.process.inspect", params, &result); err != nil {
		return "", err
	}
	return indentJSON(result)
}

func sshExec(ctx context.Context, rt Runtime, s sshScope) (string, error) {
	if err := s.requireSession(); err != nil {
		return "", err
	}
	if s.Command == "" {
		return "", fmt.Errorf("command required")
	}
	ns, err := resolveSSHNS(ctx, rt, s)
	if err != nil {
		return "", err
	}
	params := s.baseParams()
	params["command"] = s.Command
	params["stream"] = false
	var result struct {
		Stdout   string `json:"stdout"`
		Stderr   string `json:"stderr"`
		ExitCode int    `json:"exitCode"`
	}
	if err := invokeJSON(ctx, rt, ns+".exec.run", params, &result); err != nil {
		return "", err
	}
	stdout, outCut := truncateBytesKeepUTF8(result.Stdout, maxSSHExecOutBytes)
	stderr, errCut := truncateBytesKeepUTF8(result.Stderr, maxSSHExecOutBytes)
	return indentJSON(map[string]any{
		"command":   s.Command,
		"stdout":    stdout,
		"stderr":    stderr,
		"exitCode":  result.ExitCode,
		"truncated": outCut || errCut,
	})
}

func summarizeSSHMetrics(raw map[string]any) map[string]any {
	keep := []string{
		"cpuModel", "cpuCores", "cpuUsage", "kernelVersion", "osName", "uptime",
		"loadAvg1", "loadAvg5", "loadAvg15", "processes", "threads",
		"memTotal", "memUsed", "memAvailable", "swapTotal", "swapUsed",
		"tcpConnections", "networkRxBps", "networkTxBps", "networkPrimaryIface",
	}
	out := make(map[string]any, len(keep)+4)
	for _, k := range keep {
		if v, ok := raw[k]; ok {
			out[k] = v
		}
	}
	if disks, ok := raw["disks"].([]any); ok {
		out["disks"] = clipAnySlice(disks, maxSSHMetricDisks)
	}
	if procs, ok := raw["topProcesses"].([]any); ok {
		out["topProcesses"] = clipAnySlice(procs, maxSSHMetricProcs)
	}
	if procs, ok := raw["topMemoryProcesses"].([]any); ok {
		out["topMemoryProcesses"] = clipAnySlice(procs, maxSSHMetricProcs)
	}
	return out
}

func clipAnySlice(in []any, max int) []any {
	if max <= 0 || len(in) <= max {
		return in
	}
	return in[:max]
}

func truncateBytesKeepUTF8(s string, max int) (string, bool) {
	if max <= 0 || len(s) <= max {
		return s, false
	}
	cut := s[:max]
	for len(cut) > 0 && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut, true
}
