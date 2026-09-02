package loop

import (
	"niuma/platform/internal/ai/host"
	"niuma/platform/internal/ai/tool"
	"niuma/platform/internal/idgen"
	"niuma/platform/internal/store"
)

// EventPublisher 向 Shell 扇出 Platform 事件。
type EventPublisher interface {
	Publish(event map[string]any)
}

// Deps 是 Loop 引擎依赖。
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

// Service 是 Agent Loop：对话、流式、官方 host 与 MCP 调用。
type Service struct {
	Providers     *store.AIProviderStore
	Conversations *store.AIConversationStore
	MCP           *store.AIMCPStore
	Skills        *store.AISkillStore
	secrets       store.SecretStore
	ids           idgen.Generator
	events        EventPublisher
	runs          *runRegistry
	policy        *tool.Gate
	host          host.Runtime
}

// New 创建 Loop 引擎。
func New(deps Deps) *Service {
	return &Service{
		Providers:     deps.Providers,
		Conversations: deps.Conversations,
		MCP:           deps.MCP,
		Skills:        deps.Skills,
		secrets:       deps.Secrets,
		ids:           deps.IDs,
		events:        deps.Events,
		runs:          newRunRegistry(),
		policy:        tool.NewGate(),
		host:          deps.Host,
	}
}

// BindHost 在 Dispatcher 就绪后注入 Capability 运行时。
func (s *Service) BindHost(rt host.Runtime) {
	if s == nil {
		return
	}
	s.host = rt
}

func (s *Service) publish(event map[string]any) {
	if s == nil || s.events == nil {
		return
	}
	s.events.Publish(event)
}
