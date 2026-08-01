package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
)

/**
 * mcp-skill-runner — 外部 MCP（stdio JSON-RPC）。
 *
 * 为已安装的 Skill 包暴露 scripts/ 下的脚本为工具；禁止路径穿越。
 * 不编入 platform；由 Settings 安装包时注册 commandPath=mcp-skill-runner。
 */

func main() {
	skillDir := flag.String("skill-dir", "", "installed skill pack directory")
	flag.Parse()
	dir := strings.TrimSpace(*skillDir)
	if dir == "" {
		dir = strings.TrimSpace(os.Getenv("NIUMA_SKILL_DIR"))
	}
	if dir == "" {
		fmt.Fprintln(os.Stderr, "mcp-skill-runner: --skill-dir required")
		os.Exit(2)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if st, err := os.Stat(abs); err != nil || !st.IsDir() {
		fmt.Fprintf(os.Stderr, "mcp-skill-runner: skill dir not found: %s\n", abs)
		os.Exit(2)
	}
	s := &mcpServer{in: os.Stdin, out: os.Stdout, skillDir: abs}
	s.serve()
}

type mcpServer struct {
	in       io.Reader
	out      io.Writer
	skillDir string
	nextID   atomic.Int64
}

type rpcReq struct {
	JSONRPC string           `json:"jsonrpc"`
	ID      *json.RawMessage `json:"id"`
	Method  string           `json:"method"`
	Params  json.RawMessage  `json:"params"`
}

type manifestTool struct {
	Name        string `json:"name"`
	Script      string `json:"script"`
	Description string `json:"description"`
	Risk        string `json:"risk"`
}

type skillManifest struct {
	Tools []manifestTool `json:"tools"`
}

func (s *mcpServer) serve() {
	sc := bufio.NewScanner(s.in)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		var req rpcReq
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			continue
		}
		if req.Method == "" || req.ID == nil {
			continue
		}
		s.handle(req)
	}
}

func (s *mcpServer) handle(req rpcReq) {
	switch req.Method {
	case "initialize":
		s.reply(req.ID, map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo": map[string]string{
				"name":    "mcp-skill-runner",
				"version": "0.1.0",
			},
		})
	case "tools/list":
		s.reply(req.ID, map[string]any{"tools": s.toolDefs()})
	case "tools/call":
		s.reply(req.ID, s.callTool(req.Params))
	case "ping":
		s.reply(req.ID, map[string]any{})
	default:
		s.replyErr(req.ID, -32601, "method not found: "+req.Method)
	}
}

func (s *mcpServer) toolDefs() []map[string]any {
	tools := []map[string]any{
		{
			"name":        "list_skill_scripts",
			"description": "List runnable scripts in this skill pack (read-only).",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			"name":        "run_skill_script",
			"description": "Run a script under scripts/ (or a manifest-declared relative path). Args are passed to the process.",
			"inputSchema": map[string]any{
				"type":     "object",
				"required": []string{"script"},
				"properties": map[string]any{
					"script": map[string]any{
						"type":        "string",
						"description": "Script file name or relative path inside the skill pack (e.g. greet.sh or scripts/greet.sh)",
					},
					"args": map[string]any{
						"type":        "array",
						"items":       map[string]any{"type": "string"},
						"description": "Optional argv after the script",
					},
				},
			},
		},
	}
	for _, m := range s.loadManifestTools() {
		name := sanitizeToolName(m.Name)
		if name == "" {
			continue
		}
		desc := strings.TrimSpace(m.Description)
		if desc == "" {
			desc = "Run skill script " + m.Script
		}
		tools = append(tools, map[string]any{
			"name":        name,
			"description": desc,
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"args": map[string]any{
						"type":  "array",
						"items": map[string]any{"type": "string"},
					},
				},
			},
		})
	}
	return tools
}

func (s *mcpServer) callTool(params json.RawMessage) map[string]any {
	var p struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return toolError("invalid params")
	}
	var args map[string]any
	_ = json.Unmarshal(p.Arguments, &args)
	if args == nil {
		args = map[string]any{}
	}

	switch p.Name {
	case "list_skill_scripts":
		return toolText(s.listScriptsText())
	case "run_skill_script":
		script, _ := args["script"].(string)
		return s.runScript(script, stringArgs(args["args"]))
	default:
		for _, m := range s.loadManifestTools() {
			if sanitizeToolName(m.Name) == p.Name {
				return s.runScript(m.Script, stringArgs(args["args"]))
			}
		}
		return toolError("unknown tool: " + p.Name)
	}
}

func (s *mcpServer) listScriptsText() string {
	var b strings.Builder
	b.WriteString("skillDir: " + s.skillDir + "\n")
	for _, m := range s.loadManifestTools() {
		b.WriteString("- manifest: " + m.Name + " -> " + m.Script + "\n")
	}
	scripts := filepath.Join(s.skillDir, "scripts")
	entries, err := os.ReadDir(scripts)
	if err != nil {
		b.WriteString("(no scripts/ directory)\n")
		return b.String()
	}
	for _, e := range entries {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		b.WriteString("- scripts/" + e.Name() + "\n")
	}
	return b.String()
}

func (s *mcpServer) runScript(script string, argv []string) map[string]any {
	path, err := s.resolveScript(script)
	if err != nil {
		return toolError(err.Error())
	}
	cmd, err := buildScriptCmd(path, argv)
	if err != nil {
		return toolError(err.Error())
	}
	cmd.Dir = s.skillDir
	cmd.Env = append(os.Environ(),
		"NIUMA_SKILL_DIR="+s.skillDir,
		"SKILL_DIR="+s.skillDir,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	var b strings.Builder
	b.WriteString(stdout.String())
	if stderr.Len() > 0 {
		if b.Len() > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(stderr.String())
	}
	if err != nil {
		return toolError(fmt.Sprintf("%v\n%s", err, strings.TrimSpace(b.String())))
	}
	out := strings.TrimSpace(b.String())
	if out == "" {
		out = "(script exited 0 with empty output)"
	}
	return toolText(out)
}

func (s *mcpServer) resolveScript(script string) (string, error) {
	raw := strings.TrimSpace(script)
	if raw == "" {
		return "", fmt.Errorf("script required")
	}
	raw = filepath.Clean(raw)
	raw = strings.TrimPrefix(raw, string(filepath.Separator))
	if strings.Contains(raw, "..") {
		return "", fmt.Errorf("invalid script path")
	}
	candidates := []string{
		filepath.Join(s.skillDir, raw),
		filepath.Join(s.skillDir, "scripts", filepath.Base(raw)),
	}
	if !strings.Contains(raw, string(os.PathSeparator)) && !strings.Contains(raw, "/") {
		candidates = append(candidates, filepath.Join(s.skillDir, "scripts", raw))
	}
	for _, c := range candidates {
		rel, err := filepath.Rel(s.skillDir, c)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		st, err := os.Stat(c)
		if err == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("script not found: %s", script)
}

func (s *mcpServer) loadManifestTools() []manifestTool {
	raw, err := os.ReadFile(filepath.Join(s.skillDir, "manifest.json"))
	if err != nil {
		return nil
	}
	var m skillManifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil
	}
	return m.Tools
}

func buildScriptCmd(scriptPath string, argv []string) (*exec.Cmd, error) {
	ext := strings.ToLower(filepath.Ext(scriptPath))
	switch ext {
	case ".ps1":
		args := []string{"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath}
		args = append(args, argv...)
		return exec.Command("powershell", args...), nil
	case ".bat", ".cmd":
		args := append([]string{"/c", scriptPath}, argv...)
		return exec.Command("cmd", args...), nil
	case ".py":
		args := append([]string{scriptPath}, argv...)
		return exec.Command("python", args...), nil
	case ".js", ".mjs":
		args := append([]string{scriptPath}, argv...)
		return exec.Command("node", args...), nil
	case ".sh":
		shell := "bash"
		if runtime.GOOS == "windows" {
			if _, err := exec.LookPath("bash"); err != nil {
				shell = "sh"
			}
		}
		args := append([]string{scriptPath}, argv...)
		return exec.Command(shell, args...), nil
	default:
		if runtime.GOOS == "windows" && ext == ".exe" {
			return exec.Command(scriptPath, argv...), nil
		}
		// 无扩展名：直接执行（Unix）或用 cmd 试跑。
		if runtime.GOOS == "windows" {
			return nil, fmt.Errorf("unsupported script type %q on windows", ext)
		}
		return exec.Command(scriptPath, argv...), nil
	}
}

func stringArgs(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		out = append(out, fmt.Sprint(x))
	}
	return out
}

func sanitizeToolName(name string) string {
	name = strings.TrimSpace(name)
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		case r == ' ':
			b.WriteByte('_')
		}
	}
	return b.String()
}

func toolText(text string) map[string]any {
	return map[string]any{
		"content": []map[string]string{{"type": "text", "text": text}},
		"isError": false,
	}
}

func toolError(msg string) map[string]any {
	return map[string]any{
		"content": []map[string]string{{"type": "text", "text": msg}},
		"isError": true,
	}
}

func (s *mcpServer) reply(id *json.RawMessage, result any) {
	payload, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      json.RawMessage(*id),
		"result":  result,
	})
	_, _ = s.out.Write(append(payload, '\n'))
}

func (s *mcpServer) replyErr(id *json.RawMessage, code int, msg string) {
	payload, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      json.RawMessage(*id),
		"error":   map[string]any{"code": code, "message": msg},
	})
	_, _ = s.out.Write(append(payload, '\n'))
}
