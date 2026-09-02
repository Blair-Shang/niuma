package ai

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

)

const (
	skillMDFileName       = "SKILL.md"
	skillScriptsDirName   = "scripts"
	skillManifestFileName = "manifest.json"
	mcpSkillRunnerCommand = "mcp-skill-runner"
)

// SkillPackMeta 写入 skill_options.pack 的安装元数据。
type SkillPackMeta struct {
	Source      string `json:"source"`
	InstalledAt string `json:"installedAt"`
	PackPath    string `json:"packPath"`
	HasScripts  bool   `json:"hasScripts"`
	MCPServerID string `json:"mcpServerId,omitempty"`
	Description string `json:"description,omitempty"`
	Homepage    string `json:"homepage,omitempty"`
}

// SkillPackInstallParams 从本机目录或 zip 安装 Skill 包。
type SkillPackInstallParams struct {
	SourcePath string // 目录（含 SKILL.md）或 .zip
}

// SkillPackInstallResult 安装结果。
type SkillPackInstallResult struct {
	Skill       SkillView `json:"skill"`
	MCPServerID string    `json:"mcpServerId,omitempty"`
	ToolCount   int       `json:"toolCount"`
	HasScripts  bool      `json:"hasScripts"`
	PackPath    string    `json:"packPath"`
	Warning     string    `json:"warning,omitempty"`
}

// SkillPackExportParams 将已安装包导出为 zip。
type SkillPackExportParams struct {
	SkillID  string
	DestPath string
}

// InstallSkillPack 安装 OpenClaw 风格 Skill 包：复制到 skills 根目录、写入 nm_ai_skill；
// 若含 scripts/ 则注册外部 mcp-skill-runner 并尝试发现工具。
func (s *Service) InstallSkillPack(ctx context.Context, params SkillPackInstallParams) (*SkillPackInstallResult, error) {
	if s == nil || s.Skills == nil || s.ids == nil {
		return nil, fmt.Errorf("ai: skills unavailable")
	}
	src := strings.TrimSpace(params.SourcePath)
	if src == "" {
		return nil, fmt.Errorf("ai: sourcePath required")
	}
	abs, err := filepath.Abs(src)
	if err != nil {
		return nil, fmt.Errorf("ai: resolve sourcePath: %w", err)
	}
	st, err := os.Stat(abs)
	if err != nil {
		return nil, fmt.Errorf("ai: sourcePath: %w", err)
	}

	workDir := abs
	cleanup := func() {}
	if !st.IsDir() {
		if !strings.EqualFold(filepath.Ext(abs), ".zip") {
			return nil, fmt.Errorf("ai: source must be a skill directory or .zip")
		}
		tmp, err := os.MkdirTemp("", "niuma-skill-pack-*")
		if err != nil {
			return nil, err
		}
		cleanup = func() { _ = os.RemoveAll(tmp) }
		defer cleanup()
		if err := unzipTo(abs, tmp); err != nil {
			return nil, err
		}
		root, err := findSkillPackRoot(tmp)
		if err != nil {
			return nil, err
		}
		workDir = root
	}

	mdPath := filepath.Join(workDir, skillMDFileName)
	raw, err := os.ReadFile(mdPath)
	if err != nil {
		return nil, fmt.Errorf("ai: read SKILL.md: %w", err)
	}
	doc, err := parseSkillMD(string(raw))
	if err != nil {
		return nil, err
	}

	code := sanitizeSkillCode(doc.Name)
	if code == "" {
		code = sanitizeSkillCode(filepath.Base(workDir))
	}
	if code == "" {
		return nil, fmt.Errorf("ai: skill name/code required in SKILL.md")
	}
	name := strings.TrimSpace(doc.Description)
	if name == "" {
		name = code
	}
	if len(name) > 120 {
		name = name[:120]
	}

	dest, err := SkillPackDir(code)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return nil, err
	}
	// 覆盖安装：先清目标再复制。
	_ = os.RemoveAll(dest)
	if err := copyDir(workDir, dest); err != nil {
		return nil, fmt.Errorf("ai: copy skill pack: %w", err)
	}

	hasScripts := skillPackHasScripts(dest)
	mcpID := ""
	if hasScripts {
		mcpID = skillPackMCPServerID(code)
	}

	meta := SkillPackMeta{
		Source:      "openclaw",
		InstalledAt: time.Now().UTC().Format(time.RFC3339),
		PackPath:    dest,
		HasScripts:  hasScripts,
		MCPServerID: mcpID,
		Description: strings.TrimSpace(doc.Description),
		Homepage:    stringifyMeta(doc.RawFront["homepage"]),
	}
	optionsJSON, _ := json.Marshal(map[string]any{"pack": meta})

	existing, err := s.Skills.GetByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	upsert := SkillUpsertParams{
		SkillCode:      code,
		SkillName:      name,
		SkillScope:     "pack",
		PromptTemplate: doc.Body,
		ParamSchema:    "{}",
		SkillOptions:   string(optionsJSON),
		RecordStatus:   "active",
	}
	if existing != nil {
		upsert.SkillID = existing.SkillID
		upsert.RowVersion = existing.RowVersion
		if existing.SkillScope != "" && existing.SkillScope != "pack" {
			upsert.SkillScope = existing.SkillScope
		}
	}
	view, err := s.UpsertSkill(ctx, upsert)
	if err != nil {
		return nil, err
	}

	result := &SkillPackInstallResult{
		Skill:       *view,
		MCPServerID: mcpID,
		HasScripts:  hasScripts,
		PackPath:    dest,
	}

	if !hasScripts || s.MCP == nil {
		return result, nil
	}

	launch, _ := json.Marshal(map[string]any{
		"args":      []string{"--skill-dir", dest},
		"timeoutMs": 60000,
	})
	var rowVersion int64
	if prev, err := s.MCP.GetServer(ctx, mcpID); err == nil && prev != nil {
		rowVersion = prev.RowVersion
	}
	mcpView, err := s.UpsertMCPServer(ctx, MCPUpsertParams{
		ServerID:      mcpID,
		ServerName:    "Skill · " + code,
		TransportKind: "stdio",
		CommandPath:   mcpSkillRunnerCommand,
		LaunchOptions: string(launch),
		RecordStatus:  "active",
		RowVersion:    rowVersion,
	})
	if err != nil {
		result.Warning = "skill installed; MCP register failed: " + err.Error()
		return result, nil
	}
	result.MCPServerID = mcpView.ServerID

	refreshed, err := s.RefreshMCPTools(ctx, mcpView.ServerID)
	if err != nil {
		result.Warning = "skill installed; tool discovery failed (build mcp-skill-runner?): " + err.Error()
		return result, nil
	}
	result.ToolCount = len(refreshed.Tools)
	return result, nil
}

// UninstallSkillPack 卸载包：删 MCP（若有）、删 Skill、删安装目录。
func (s *Service) UninstallSkillPack(ctx context.Context, skillID string) (bool, error) {
	if s == nil || s.Skills == nil {
		return false, fmt.Errorf("ai: skills unavailable")
	}
	skillID = strings.TrimSpace(skillID)
	if skillID == "" {
		return false, fmt.Errorf("ai: skillId required")
	}
	sk, err := s.Skills.Get(ctx, skillID)
	if err != nil {
		return false, err
	}
	if sk == nil {
		return false, nil
	}
	meta := parseSkillPackMeta(sk.SkillOptions)
	if meta != nil && meta.MCPServerID != "" && s.MCP != nil {
		_, _ = s.DeleteMCPServer(ctx, meta.MCPServerID)
	}
	if err := s.Skills.Delete(ctx, skillID); err != nil {
		return false, err
	}
	if meta != nil && meta.PackPath != "" {
		root, _ := SkillsRootDir()
		if root != "" {
			rel, err := filepath.Rel(root, meta.PackPath)
			if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
				_ = os.RemoveAll(meta.PackPath)
			}
		}
	}
	return true, nil
}

// ExportSkillPack 将已安装包打成 zip 写到 destPath（供「下载/分享」）。
func (s *Service) ExportSkillPack(ctx context.Context, params SkillPackExportParams) (string, error) {
	if s == nil || s.Skills == nil {
		return "", fmt.Errorf("ai: skills unavailable")
	}
	skillID := strings.TrimSpace(params.SkillID)
	dest := strings.TrimSpace(params.DestPath)
	if skillID == "" || dest == "" {
		return "", fmt.Errorf("ai: skillId and destPath required")
	}
	sk, err := s.Skills.Get(ctx, skillID)
	if err != nil {
		return "", err
	}
	if sk == nil {
		return "", fmt.Errorf("ai: skill not found")
	}
	meta := parseSkillPackMeta(sk.SkillOptions)
	packPath := ""
	if meta != nil {
		packPath = meta.PackPath
	}
	if packPath == "" {
		// 非包安装的 Skill：导出最小 SKILL.md 包。
		tmp, err := os.MkdirTemp("", "niuma-skill-export-*")
		if err != nil {
			return "", err
		}
		defer os.RemoveAll(tmp)
		dir := filepath.Join(tmp, sanitizeSkillCode(sk.SkillCode))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", err
		}
		md := "---\nname: " + sk.SkillCode + "\ndescription: " + yamlQuote(sk.SkillName) + "\n---\n\n" + sk.PromptTemplate + "\n"
		if err := os.WriteFile(filepath.Join(dir, skillMDFileName), []byte(md), 0o644); err != nil {
			return "", err
		}
		packPath = dir
	}
	if st, err := os.Stat(packPath); err != nil || !st.IsDir() {
		return "", fmt.Errorf("ai: skill pack directory missing; reinstall the pack")
	}
	if err := zipDir(packPath, dest); err != nil {
		return "", err
	}
	abs, _ := filepath.Abs(dest)
	return abs, nil
}

func yamlQuote(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		return `"` + strings.ReplaceAll(s, `"`, `'`) + `"`
	}
	return string(b)
}

func parseSkillPackMeta(skillOptions string) *SkillPackMeta {
	raw := strings.TrimSpace(skillOptions)
	if raw == "" || raw == "{}" {
		return nil
	}
	var wrap struct {
		Pack *SkillPackMeta `json:"pack"`
	}
	if err := json.Unmarshal([]byte(raw), &wrap); err != nil || wrap.Pack == nil {
		return nil
	}
	return wrap.Pack
}

func skillPackHasScripts(packDir string) bool {
	scripts := filepath.Join(packDir, skillScriptsDirName)
	st, err := os.Stat(scripts)
	if err != nil || !st.IsDir() {
		return false
	}
	entries, err := os.ReadDir(scripts)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		return true
	}
	// manifest 声明工具也算。
	if _, err := os.Stat(filepath.Join(packDir, skillManifestFileName)); err == nil {
		return true
	}
	return false
}

func findSkillPackRoot(dir string) (string, error) {
	if _, err := os.Stat(filepath.Join(dir, skillMDFileName)); err == nil {
		return dir, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	var candidates []string
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		p := filepath.Join(dir, e.Name())
		if _, err := os.Stat(filepath.Join(p, skillMDFileName)); err == nil {
			candidates = append(candidates, p)
		}
	}
	if len(candidates) == 1 {
		return candidates[0], nil
	}
	if len(candidates) > 1 {
		return "", fmt.Errorf("ai: zip contains multiple SKILL.md packs")
	}
	return "", fmt.Errorf("ai: SKILL.md not found in pack")
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return os.MkdirAll(dst, 0o755)
		}
		// 跳过常见无关目录。
		base := info.Name()
		if info.IsDir() && (base == ".git" || base == "node_modules" || base == "__pycache__") {
			return filepath.SkipDir
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target, info.Mode())
	})
}

func copyFile(src, dst string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode.Perm())
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func unzipTo(zipPath, dest string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("ai: open zip: %w", err)
	}
	defer r.Close()
	destAbs, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	for _, f := range r.File {
		name := filepath.Clean(f.Name)
		if name == "." || strings.HasPrefix(name, "..") {
			continue
		}
		target := filepath.Join(destAbs, name)
		rel, err := filepath.Rel(destAbs, target)
		if err != nil || strings.HasPrefix(rel, "..") {
			return fmt.Errorf("ai: zip entry escapes destination: %s", f.Name)
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
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode().Perm())
		if err != nil {
			rc.Close()
			return err
		}
		_, copyErr := io.Copy(out, rc)
		closeErr := out.Close()
		rc.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func zipDir(srcDir, destZip string) error {
	if err := os.MkdirAll(filepath.Dir(destZip), 0o755); err != nil {
		return err
	}
	out, err := os.Create(destZip)
	if err != nil {
		return err
	}
	defer out.Close()
	zw := zip.NewWriter(out)
	defer zw.Close()
	base := filepath.Base(srcDir)
	return filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		if info.IsDir() && (info.Name() == ".git" || info.Name() == "node_modules") {
			return filepath.SkipDir
		}
		name := filepath.ToSlash(filepath.Join(base, rel))
		if info.IsDir() {
			_, err := zw.Create(name + "/")
			return err
		}
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(w, f)
		f.Close()
		return copyErr
	})
}
