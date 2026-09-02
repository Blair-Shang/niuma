package ai

import (
	"niuma/platform/internal/ai/loop"
	"niuma/platform/internal/ai/mcp"
	"niuma/platform/internal/ai/skill"
	"niuma/platform/internal/store"
)

// 根包保留 handler 使用的类型名，实现落在子目录。

type (
	// StreamParams 是启动流式对话的入参。
	StreamParams = loop.StreamParams
	// StreamStartResult 是 stream 立即返回给 Bridge 的结果。
	StreamStartResult = loop.StreamStartResult
	// ContextDraft 是 Web 采集的 Context Pack 草稿。
	ContextDraft = loop.ContextDraft
	// ProbeParams 是 Provider 连通探测入参。
	ProbeParams = loop.ProbeParams
	// RemoteModel 是上游 /models 返回的条目。
	RemoteModel = loop.RemoteModel
	// TestResult 是连通探测结果。
	TestResult = loop.TestResult
	// SystemModelSpec 是系统模型目录中的一条模型。
	SystemModelSpec = loop.SystemModelSpec
	// EnsureSystemParams 是登录后同步系统 Provider 的入参。
	EnsureSystemParams = loop.EnsureSystemParams
	// EnsureSystemResult 是同步结果。
	EnsureSystemResult = loop.EnsureSystemResult
	// MCPUpsertParams 新建或更新 MCP Server。
	MCPUpsertParams = mcp.MCPUpsertParams
	// SkillUpsertParams 新建或更新 Skill。
	SkillUpsertParams = skill.SkillUpsertParams
	// SkillPackInstallParams 从本机目录或 zip 安装 Skill 包。
	SkillPackInstallParams = skill.SkillPackInstallParams
	// SkillPackExportParams 将已安装包导出为 zip。
	SkillPackExportParams = skill.SkillPackExportParams
)

// IsSystemProviderID 判断是否为系统 Provider 主键。
func IsSystemProviderID(id string) bool { return loop.IsSystemProviderID(id) }

// IsSystemProvider 判断库中的 Provider 是否由云端系统模型托管。
func IsSystemProvider(p *store.AIProvider) bool { return loop.IsSystemProvider(p) }
