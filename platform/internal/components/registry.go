package components

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// ToolStatusDTO 是单个工具的探测结果（Bridge 返回）。
type ToolStatusDTO struct {
	ToolID       string `json:"toolId"`
	DisplayName  string `json:"displayName"`
	Status       string `json:"status"`
	Path         string `json:"path,omitempty"`
	Version      string `json:"version,omitempty"`
	DownloadPage string `json:"downloadPage,omitempty"`
	// Installable 表示当前平台可为该工具单独下载安装 / 重新安装。
	Installable bool `json:"installable,omitempty"`
}

// BundleStatusDTO 是组件包及其工具列表的探测结果。
type BundleStatusDTO struct {
	BundleID    string          `json:"bundleId"`
	Name        string          `json:"name"`
	Module      string          `json:"module,omitempty"`
	Installable bool            `json:"installable,omitempty"`
	Tools       []ToolStatusDTO `json:"tools"`
}

// pathMap 是 settings 中 components.tool_paths 的 JSON 结构。
type pathMap map[string]map[string]string

// Registry 管理组件包 manifest 与路径探测。
type Registry struct {
	bundles     map[string]*BundleManifest
	settingsGet func(ctx context.Context, key string) (value string, ok bool, err error)
	settingsSet func(ctx context.Context, key, value string) error
	bundledRoot string
}

// SettingsAccessor 抽象 nm_app_setting 读写，便于测试注入。
type SettingsAccessor interface {
	Get(ctx context.Context, key string) (value string, ok bool, err error)
	Set(ctx context.Context, key, value string) error
}

// NewRegistry 加载 components 目录下的全部 manifest。
func NewRegistry(componentsDir string, settings SettingsAccessor, dataDir string) (*Registry, error) {
	bundles, err := LoadBundleManifests(componentsDir)
	if err != nil {
		return nil, err
	}
	bundledRoot := ""
	if dataDir != "" {
		bundledRoot = filepath.Join(dataDir, "components")
	}
	return &Registry{
		bundles: bundles,
		settingsGet: func(ctx context.Context, key string) (string, bool, error) {
			return settings.Get(ctx, key)
		},
		settingsSet: func(ctx context.Context, key, value string) error {
			return settings.Set(ctx, key, value)
		},
		bundledRoot: bundledRoot,
	}, nil
}

// List 返回全部或指定组件包的探测状态。
func (r *Registry) List(ctx context.Context, bundleID string) ([]BundleStatusDTO, error) {
	paths, err := r.loadPaths(ctx)
	if err != nil {
		return nil, err
	}
	if bundleID != "" {
		m, ok := r.bundles[bundleID]
		if !ok {
			return nil, fmt.Errorf("components: bundle not found: %s", bundleID)
		}
		status, err := r.bundleStatus(ctx, m, paths)
		if err != nil {
			return nil, err
		}
		return []BundleStatusDTO{status}, nil
	}

	ids := make([]string, 0, len(r.bundles))
	for id := range r.bundles {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	out := make([]BundleStatusDTO, 0, len(ids))
	for _, id := range ids {
		status, err := r.bundleStatus(ctx, r.bundles[id], paths)
		if err != nil {
			return nil, err
		}
		out = append(out, status)
	}
	return out, nil
}

// Detect 重新探测指定组件包（与 List 单包语义相同）。
func (r *Registry) Detect(ctx context.Context, bundleID string) (BundleStatusDTO, error) {
	items, err := r.List(ctx, bundleID)
	if err != nil {
		return BundleStatusDTO{}, err
	}
	return items[0], nil
}

// SetPath 设置或清除某工具的用户指定路径（空字符串表示清除）。
func (r *Registry) SetPath(ctx context.Context, bundleID, toolID, path string) error {
	m, ok := r.bundles[bundleID]
	if !ok {
		return fmt.Errorf("components: bundle not found: %s", bundleID)
	}
	if !m.hasTool(toolID) {
		return fmt.Errorf("components: tool not found: %s/%s", bundleID, toolID)
	}
	path = stringsTrim(path)
	if path != "" && !fileExists(path) {
		return fmt.Errorf("components: executable not found: %s", path)
	}

	paths, err := r.loadPaths(ctx)
	if err != nil {
		return err
	}
	if paths == nil {
		paths = pathMap{}
	}
	if paths[bundleID] == nil {
		paths[bundleID] = map[string]string{}
	}
	if path == "" {
		delete(paths[bundleID], toolID)
		if len(paths[bundleID]) == 0 {
			delete(paths, bundleID)
		}
	} else {
		abs, absErr := filepath.Abs(path)
		if absErr == nil {
			path = abs
		}
		paths[bundleID][toolID] = path
	}
	raw, err := json.Marshal(paths)
	if err != nil {
		return fmt.Errorf("components: marshal paths: %w", err)
	}
	return r.settingsSet(ctx, SettingsKey, string(raw))
}

// GetDownloadURL 返回 manifest 中声明的官方下载页。
func (r *Registry) GetDownloadURL(bundleID, toolID string) (string, error) {
	m, ok := r.bundles[bundleID]
	if !ok {
		return "", fmt.Errorf("components: bundle not found: %s", bundleID)
	}
	for _, tool := range m.Tools {
		if tool.ID == toolID {
			if tool.Install.DownloadPage == "" {
				return "", fmt.Errorf("components: no download page for %s", toolID)
			}
			return tool.Install.DownloadPage, nil
		}
	}
	return "", fmt.Errorf("components: tool not found: %s/%s", bundleID, toolID)
}

// EffectivePath 解析某工具的有效路径（供能力服务后续调用）。
func (r *Registry) EffectivePath(ctx context.Context, bundleID, toolID string) (string, error) {
	paths, err := r.loadPaths(ctx)
	if err != nil {
		return "", err
	}
	m, ok := r.bundles[bundleID]
	if !ok {
		return "", fmt.Errorf("components: bundle not found: %s", bundleID)
	}
	tool := m.toolByID(toolID)
	if tool == nil {
		return "", fmt.Errorf("components: tool not found: %s/%s", bundleID, toolID)
	}
	status := r.resolveTool(ctx, m.ID, *tool, paths)
	if status.Status == ToolStatusMissing {
		return "", fmt.Errorf("components: tool missing: %s/%s", bundleID, toolID)
	}
	return status.Path, nil
}

func (m *BundleManifest) hasTool(toolID string) bool {
	return m.toolByID(toolID) != nil
}

func (m *BundleManifest) toolByID(toolID string) *ToolSpec {
	for i := range m.Tools {
		if m.Tools[i].ID == toolID {
			return &m.Tools[i]
		}
	}
	return nil
}

func (r *Registry) bundleStatus(ctx context.Context, m *BundleManifest, paths pathMap) (BundleStatusDTO, error) {
	tools := make([]ToolStatusDTO, 0, len(m.Tools))
	for _, tool := range m.Tools {
		dto := r.resolveTool(ctx, m.ID, tool, paths)
		dto.Installable = m.toolInstallable(tool.ID)
		tools = append(tools, dto)
	}
	return BundleStatusDTO{
		BundleID:    m.ID,
		Name:        m.Name,
		Module:      m.Module,
		Tools:       tools,
		Installable: m.SupportsInstall() && len(matchingPackages(m.Install.Packages, "")) > 0,
	}, nil
}

func (r *Registry) resolveTool(ctx context.Context, bundleID string, tool ToolSpec, paths pathMap) ToolStatusDTO {
	dto := ToolStatusDTO{
		ToolID:       tool.ID,
		DisplayName:  tool.DisplayName,
		Status:       ToolStatusMissing,
		DownloadPage: tool.Install.DownloadPage,
	}

	if configured := stringsTrim(paths[bundleID][tool.ID]); configured != "" {
		if fileExists(configured) {
			dto.Status = ToolStatusConfigured
			dto.Path = configured
			dto.Version = probeVersion(ctx, configured, tool.Detect.VersionArgs)
			return dto
		}
	}

	for _, exeName := range tool.Detect.Executables {
		candidate := bundledPath(r.bundledRoot, bundleID, exeName)
		if fileExists(candidate) {
			dto.Status = ToolStatusBundled
			dto.Path = candidate
			dto.Version = probeVersion(ctx, candidate, tool.Detect.VersionArgs)
			return dto
		}
	}

	if path, ok := findOnPath(tool.Detect.Executables); ok {
		dto.Status = ToolStatusDetected
		dto.Path = path
		dto.Version = probeVersion(ctx, path, tool.Detect.VersionArgs)
		return dto
	}

	return dto
}

func (r *Registry) loadPaths(ctx context.Context) (pathMap, error) {
	raw, ok, err := r.settingsGet(ctx, SettingsKey)
	if err != nil {
		return nil, err
	}
	if !ok || raw == "" {
		return pathMap{}, nil
	}
	var out pathMap
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, fmt.Errorf("components: parse tool paths: %w", err)
	}
	return out, nil
}

func stringsTrim(s string) string {
	return strings.TrimSpace(s)
}
