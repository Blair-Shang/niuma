package ai

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"niuma/platform/internal/store"
)

const (
	// MessageRoleUser 表示用户消息。
	MessageRoleUser = "user"
	// MessageRoleAssistant 表示助手消息。
	MessageRoleAssistant = "assistant"
	// MessageRoleSystem 表示系统消息。
	MessageRoleSystem = "system"

	credentialServicePrefix = "NiuMa/credential/"
	credentialSecretAccount = "secret"
	// chatHistoryLimit 入模时取会话最近 N 条消息（会话上下文窗口，非摘要压缩）。
	chatHistoryLimit = 40
)

// StreamParams 是启动流式对话的入参。
type StreamParams struct {
	ConversationID string
	Content        string
	ProviderID     string
	ModelCode      string
	// Context 是 Web 采集的 Context Pack 草稿；入模前 Normalize。
	Context *ContextDraft
	// SkillCode 可选：装配 nm_ai_skill 提示词模板。
	SkillCode string
	// RegenerateFromMessageID 若设置：删除该 assistant 及之后记录，基于前置 user 重跑。
	RegenerateFromMessageID string
	// EditFromMessageID 若设置：删除该 user 及之后记录，以 Content 作为新用户消息重跑。
	EditFromMessageID string
}

// StreamStartResult 是 stream 立即返回给 Bridge 的结果。
type StreamStartResult struct {
	RunID          string
	ConversationID string
	UserMessageID  string
}

// runRegistry 跟踪进行中的流式 run，供 Cancel 使用。
type runRegistry struct {
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func newRunRegistry() *runRegistry {
	return &runRegistry{cancels: make(map[string]context.CancelFunc)}
}

func (r *runRegistry) put(runID string, cancel context.CancelFunc) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cancels[runID] = cancel
}

func (r *runRegistry) take(runID string) (context.CancelFunc, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cancel, ok := r.cancels[runID]
	if ok {
		delete(r.cancels, runID)
	}
	return cancel, ok
}

func (r *runRegistry) remove(runID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.cancels, runID)
}

// StartStream 落库用户消息并异步启动 LLM 流式调用；立即返回 runId。
func (s *Service) StartStream(ctx context.Context, params StreamParams) (*StreamStartResult, error) {
	if s == nil || s.Conversations == nil || s.Providers == nil {
		return nil, fmt.Errorf("ai: service unavailable")
	}
	if params.ConversationID == "" {
		return nil, fmt.Errorf("ai: conversationId required")
	}
	if params.RegenerateFromMessageID != "" {
		return s.startRegenerate(ctx, params)
	}
	if params.EditFromMessageID != "" {
		return s.startEdit(ctx, params)
	}

	content := strings.TrimSpace(params.Content)
	if content == "" {
		return nil, fmt.Errorf("ai: content required")
	}
	if stripAllMarkers(content) == "" && !hasAttachmentMarkers(content) {
		return nil, fmt.Errorf("ai: content required")
	}
	// 可见正文入库存（可含 nm-ref / nm-img / nm-txt 标记）；Context 仅当轮入模。
	displayContent := content

	conv, err := s.Conversations.GetConversation(ctx, params.ConversationID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		return nil, fmt.Errorf("ai: conversation not found")
	}

	providerID := params.ProviderID
	if providerID == "" {
		providerID = conv.ProviderID
	}
	modelCode := params.ModelCode
	if modelCode == "" {
		modelCode = conv.ModelCode
	}
	provider, apiKey, resolvedModel, err := s.resolveChatProvider(ctx, providerID, modelCode)
	if err != nil {
		return nil, err
	}

	userMsgID, err := s.ids.NextString()
	if err != nil {
		return nil, err
	}
	if err := s.Conversations.AppendMessage(ctx, store.AIMessage{
		MessageID:      userMsgID,
		ConversationID: params.ConversationID,
		MessageRole:    MessageRoleUser,
		MessageContent: displayContent,
	}); err != nil {
		return nil, err
	}

	title := conv.ConversationTitle
	if strings.TrimSpace(title) == "" {
		plain := stripAllMarkers(displayContent)
		if plain == "" && hasAttachmentMarkers(displayContent) {
			title = "附件对话"
		} else {
			title = truncateRunes(plain, 40)
		}
	}
	_ = s.Conversations.TouchConversation(ctx, params.ConversationID, title, provider.ProviderID, resolvedModel)

	history, err := s.Conversations.ListMessages(ctx, params.ConversationID)
	if err != nil {
		return nil, err
	}

	normalized := NormalizeContext(params.Context)
	skillPrompt := s.resolveSkillPrompt(ctx, params.SkillCode)
	return s.launchStream(ctx, params.ConversationID, userMsgID, displayContent, true, provider, apiKey, resolvedModel, history, normalized, skillPrompt)
}

// startRegenerate 删除指定 assistant 及之后消息，基于前置 user 重跑。
func (s *Service) startRegenerate(ctx context.Context, params StreamParams) (*StreamStartResult, error) {
	msgs, err := s.Conversations.ListMessages(ctx, params.ConversationID)
	if err != nil {
		return nil, err
	}
	idx := -1
	for i, m := range msgs {
		if m.MessageID == params.RegenerateFromMessageID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, fmt.Errorf("ai: message not found")
	}
	if msgs[idx].MessageRole != MessageRoleAssistant {
		return nil, fmt.Errorf("ai: regenerate requires assistant message")
	}
	userMsgID := ""
	userContent := ""
	for i := idx - 1; i >= 0; i-- {
		if msgs[i].MessageRole == MessageRoleUser {
			userMsgID = msgs[i].MessageID
			userContent = msgs[i].MessageContent
			break
		}
	}
	if userMsgID == "" || strings.TrimSpace(userContent) == "" {
		return nil, fmt.Errorf("ai: preceding user message not found")
	}

	conv, err := s.Conversations.GetConversation(ctx, params.ConversationID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		return nil, fmt.Errorf("ai: conversation not found")
	}
	providerID := params.ProviderID
	if providerID == "" {
		providerID = conv.ProviderID
	}
	modelCode := params.ModelCode
	if modelCode == "" {
		modelCode = conv.ModelCode
	}
	provider, apiKey, resolvedModel, err := s.resolveChatProvider(ctx, providerID, modelCode)
	if err != nil {
		return nil, err
	}

	if err := s.Conversations.DeleteMessagesFrom(ctx, params.ConversationID, params.RegenerateFromMessageID); err != nil {
		return nil, err
	}
	history, err := s.Conversations.ListMessages(ctx, params.ConversationID)
	if err != nil {
		return nil, err
	}
	_ = s.Conversations.TouchConversation(ctx, params.ConversationID, "", provider.ProviderID, resolvedModel)
	skillPrompt := s.resolveSkillPrompt(ctx, params.SkillCode)
	normalized := NormalizeContext(params.Context)
	return s.launchStream(ctx, params.ConversationID, userMsgID, userContent, false, provider, apiKey, resolvedModel, history, normalized, skillPrompt)
}

// RenameConversation 更新会话标题，返回规范化后的标题。
func (s *Service) RenameConversation(ctx context.Context, conversationID, title string) (string, error) {
	if s == nil || s.Conversations == nil {
		return "", fmt.Errorf("ai: service unavailable")
	}
	conversationID = strings.TrimSpace(conversationID)
	title = strings.TrimSpace(title)
	if conversationID == "" {
		return "", fmt.Errorf("ai: conversationId required")
	}
	if title == "" {
		return "", fmt.Errorf("ai: title required")
	}
	if utf8.RuneCountInString(title) > 120 {
		title = truncateRunes(title, 120)
	}
	conv, err := s.Conversations.GetConversation(ctx, conversationID)
	if err != nil {
		return "", err
	}
	if conv == nil {
		return "", fmt.Errorf("ai: conversation not found")
	}
	if err := s.Conversations.TouchConversation(ctx, conversationID, title, "", ""); err != nil {
		return "", err
	}
	return title, nil
}

// startEdit 删除指定 user 及之后消息，以新 Content 写入并重跑。
func (s *Service) startEdit(ctx context.Context, params StreamParams) (*StreamStartResult, error) {
	content := strings.TrimSpace(params.Content)
	if content == "" {
		return nil, fmt.Errorf("ai: content required")
	}
	if stripAllMarkers(content) == "" && !hasAttachmentMarkers(content) {
		return nil, fmt.Errorf("ai: content required")
	}
	msgs, err := s.Conversations.ListMessages(ctx, params.ConversationID)
	if err != nil {
		return nil, err
	}
	idx := -1
	for i, m := range msgs {
		if m.MessageID == params.EditFromMessageID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, fmt.Errorf("ai: message not found")
	}
	if msgs[idx].MessageRole != MessageRoleUser {
		return nil, fmt.Errorf("ai: edit requires user message")
	}

	conv, err := s.Conversations.GetConversation(ctx, params.ConversationID)
	if err != nil {
		return nil, err
	}
	if conv == nil {
		return nil, fmt.Errorf("ai: conversation not found")
	}
	providerID := params.ProviderID
	if providerID == "" {
		providerID = conv.ProviderID
	}
	modelCode := params.ModelCode
	if modelCode == "" {
		modelCode = conv.ModelCode
	}
	provider, apiKey, resolvedModel, err := s.resolveChatProvider(ctx, providerID, modelCode)
	if err != nil {
		return nil, err
	}

	if err := s.Conversations.DeleteMessagesFrom(ctx, params.ConversationID, params.EditFromMessageID); err != nil {
		return nil, err
	}

	userMsgID, err := s.ids.NextString()
	if err != nil {
		return nil, err
	}
	if err := s.Conversations.AppendMessage(ctx, store.AIMessage{
		MessageID:      userMsgID,
		ConversationID: params.ConversationID,
		MessageRole:    MessageRoleUser,
		MessageContent: content,
	}); err != nil {
		return nil, err
	}

	title := conv.ConversationTitle
	if strings.TrimSpace(title) == "" {
		plain := stripAllMarkers(content)
		if plain == "" && hasAttachmentMarkers(content) {
			title = "附件对话"
		} else {
			title = truncateRunes(plain, 40)
		}
	}
	_ = s.Conversations.TouchConversation(ctx, params.ConversationID, title, provider.ProviderID, resolvedModel)

	history, err := s.Conversations.ListMessages(ctx, params.ConversationID)
	if err != nil {
		return nil, err
	}
	normalized := NormalizeContext(params.Context)
	skillPrompt := s.resolveSkillPrompt(ctx, params.SkillCode)
	return s.launchStream(ctx, params.ConversationID, userMsgID, content, true, provider, apiKey, resolvedModel, history, normalized, skillPrompt)
}

func (s *Service) launchStream(
	_ context.Context,
	conversationID, userMsgID, content string,
	publishUser bool,
	provider *store.AIProvider,
	apiKey, resolvedModel string,
	history []store.AIMessage,
	normalized NormalizedContext,
	skillPrompt string,
) (*StreamStartResult, error) {
	runID, err := s.ids.NextString()
	if err != nil {
		return nil, err
	}
	runCtx, cancel := context.WithCancel(context.Background())
	s.runs.put(runID, cancel)

	if publishUser {
		s.publish(map[string]any{
			"type":           "platform.ai.message",
			"runId":          runID,
			"conversationId": conversationID,
			"messageId":      userMsgID,
			"role":           MessageRoleUser,
			"content":        content,
		})
	}
	s.publish(map[string]any{
		"type":           "platform.ai.run.status",
		"runId":          runID,
		"conversationId": conversationID,
		"status":         "running",
	})

	go s.runChatStream(runCtx, runID, conversationID, provider, apiKey, resolvedModel, history, normalized, skillPrompt)

	return &StreamStartResult{
		RunID:          runID,
		ConversationID: conversationID,
		UserMessageID:  userMsgID,
	}, nil
}

// resolveSkillPrompt 读取启用中的 Skill 模板；找不到则返回空。
func (s *Service) resolveSkillPrompt(ctx context.Context, skillCode string) string {
	code := strings.TrimSpace(skillCode)
	if code == "" || s == nil || s.Skills == nil {
		return ""
	}
	sk, err := s.Skills.GetByCode(ctx, code)
	if err != nil || sk == nil {
		return ""
	}
	if sk.RecordStatus != "" && sk.RecordStatus != "active" {
		return ""
	}
	return applySkillTemplate(sk.PromptTemplate, sk.ParamSchema)
}

// Cancel 取消进行中的流式 run；不存在时返回 cancelled=false。
// 同时拒绝该 run 下所有 Policy Gate 待确认项。
func (s *Service) Cancel(runID string) (cancelled bool) {
	if s == nil || runID == "" || s.runs == nil {
		return false
	}
	cancel, ok := s.runs.take(runID)
	if !ok {
		return false
	}
	if s.policy != nil {
		s.policy.rejectRun(runID)
	}
	cancel()
	s.publish(map[string]any{
		"type":   "platform.ai.run.status",
		"runId":  runID,
		"status": "cancelled",
	})
	return true
}

func (s *Service) resolveChatProvider(ctx context.Context, providerID, modelCode string) (*store.AIProvider, string, string, error) {
	var provider *store.AIProvider
	var err error
	if providerID != "" {
		provider, err = s.Providers.GetProvider(ctx, providerID)
		if err != nil {
			return nil, "", "", err
		}
		if provider == nil {
			return nil, "", "", fmt.Errorf("ai: provider not found")
		}
	} else {
		list, listErr := s.Providers.ListProviders(ctx, "active")
		if listErr != nil {
			return nil, "", "", listErr
		}
		if len(list) == 0 {
			list, listErr = s.Providers.ListProviders(ctx, "")
			if listErr != nil {
				return nil, "", "", listErr
			}
		}
		if len(list) == 0 {
			return nil, "", "", fmt.Errorf("ai: no ai provider configured")
		}
		provider = &list[0]
	}

	resolvedModel := modelCode
	if resolvedModel == "" {
		resolvedModel = provider.DefaultModelCode
	}
	if resolvedModel == "" {
		return nil, "", "", fmt.Errorf("ai: modelCode required")
	}
	if provider.CredentialID == "" {
		if strings.EqualFold(provider.ProviderKind, "ollama") {
			return provider, "", resolvedModel, nil
		}
		return nil, "", "", fmt.Errorf("ai: api key not configured")
	}
	secret, ok, secretErr := s.secrets.GetSecret(credentialServicePrefix+provider.CredentialID, credentialSecretAccount)
	if secretErr != nil {
		return nil, "", "", secretErr
	}
	if !ok || strings.TrimSpace(secret) == "" {
		if strings.EqualFold(provider.ProviderKind, "ollama") {
			return provider, "", resolvedModel, nil
		}
		return nil, "", "", fmt.Errorf("ai: api key not configured")
	}
	return provider, secret, resolvedModel, nil
}

func truncateRunes(s string, max int) string {
	if max <= 0 || s == "" {
		return s
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[:max])
}
