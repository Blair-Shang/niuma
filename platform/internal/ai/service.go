package ai

import (
	"context"

	"niuma/platform/internal/ai/host"
	"niuma/platform/internal/ai/loop"
	"niuma/platform/internal/ai/mcp"
	"niuma/platform/internal/ai/skill"
	"niuma/platform/internal/idgen"
	"niuma/platform/internal/store"
)

// EventPublisher 向 Shell 扇出 Platform 事件（由 eventhub 实现）。
type EventPublisher = loop.EventPublisher

// Deps 汇集 AI 领域服务所需依赖。
type Deps struct {
	Providers     *store.AIProviderStore
	Conversations *store.AIConversationStore
	MCP           *store.AIMCPStore
	Skills        *store.AISkillStore
	Secrets       store.SecretStore
	IDs           idgen.Generator
	Events        EventPublisher
	Host          host.Runtime
}

// Service 是 AI 助手组合根：Loop + 官方 host + 扩展 MCP + Skills。
//
// Handler 仍只依赖本类型；实现按目录拆在 loop / mcp / skill / host / tool。
type Service struct {
	*loop.Service
	*mcp.API
	skills *skill.API
}

// NewService 创建 AI 领域服务。
func NewService(deps Deps) *Service {
	lp := loop.New(loop.Deps{
		Providers:     deps.Providers,
		Conversations: deps.Conversations,
		MCP:           deps.MCP,
		Skills:        deps.Skills,
		Secrets:       deps.Secrets,
		IDs:           deps.IDs,
		Events:        deps.Events,
		Host:          deps.Host,
	})
	mcpAPI := mcp.New(deps.MCP, deps.IDs, deps.Secrets)
	return &Service{
		Service: lp,
		API:     mcpAPI,
		skills:  skill.New(deps.Skills, deps.IDs, mcpAPI),
	}
}

// BindHost 在 Dispatcher 就绪后注入 Capability 运行时。
func (s *Service) BindHost(rt host.Runtime) {
	if s == nil || s.Service == nil {
		return
	}
	s.Service.BindHost(rt)
}

func (s *Service) skillAPI() *skill.API {
	if s == nil {
		return nil
	}
	return s.skills
}

// ListSkills 列出 Skill。
func (s *Service) ListSkills(ctx context.Context, status string) ([]skill.SkillView, error) {
	return s.skillAPI().ListSkills(ctx, status)
}

// GetSkill 读取单个 Skill。
func (s *Service) GetSkill(ctx context.Context, skillID string) (*skill.SkillView, error) {
	return s.skillAPI().GetSkill(ctx, skillID)
}

// UpsertSkill 新建或更新 Skill。
func (s *Service) UpsertSkill(ctx context.Context, params skill.SkillUpsertParams) (*skill.SkillView, error) {
	return s.skillAPI().UpsertSkill(ctx, params)
}

// DeleteSkill 删除 Skill。
func (s *Service) DeleteSkill(ctx context.Context, skillID string) (bool, error) {
	return s.skillAPI().DeleteSkill(ctx, skillID)
}

// InstallSkillPack 安装 Skill 包。
func (s *Service) InstallSkillPack(ctx context.Context, params skill.SkillPackInstallParams) (*skill.SkillPackInstallResult, error) {
	return s.skillAPI().InstallSkillPack(ctx, params)
}

// ExportSkillPack 导出 Skill 包。
func (s *Service) ExportSkillPack(ctx context.Context, params skill.SkillPackExportParams) (string, error) {
	return s.skillAPI().ExportSkillPack(ctx, params)
}
