package ai

import (
	"niuma/platform/internal/idgen"
	"niuma/platform/internal/store"
)

// EventPublisher 向 Shell 扇出 Platform 事件（由 eventhub 实现）。
type EventPublisher interface {
	Publish(event map[string]any)
}

// Deps 汇集 AI 领域服务所需依赖。
type Deps struct {
	Providers     *store.AIProviderStore
	Conversations *store.AIConversationStore
	MCP           *store.AIMCPStore
	Skills        *store.AISkillStore
	Secrets       store.SecretStore
	IDs           idgen.Generator
	Events        EventPublisher
}

// Service 是 AI 助手领域服务：会话读写、流式对话编排、LLM 调用、MCP 配置。
//
// Handler 仅做 Bridge 入参校验与结果封装，业务逻辑集中在本类型。
type Service struct {
	Providers     *store.AIProviderStore
	Conversations *store.AIConversationStore
	MCP           *store.AIMCPStore
	Skills        *store.AISkillStore
	secrets       store.SecretStore
	ids           idgen.Generator
	events        EventPublisher
	runs          *runRegistry
	policy        *policyGate
}

// NewService 创建 AI 领域服务。
func NewService(deps Deps) *Service {
	return &Service{
		Providers:     deps.Providers,
		Conversations: deps.Conversations,
		MCP:           deps.MCP,
		Skills:        deps.Skills,
		secrets:       deps.Secrets,
		ids:           deps.IDs,
		events:        deps.Events,
		runs:          newRunRegistry(),
		policy:        newPolicyGate(),
	}
}

func (s *Service) publish(event map[string]any) {
	if s == nil || s.events == nil {
		return
	}
	s.events.Publish(event)
}
