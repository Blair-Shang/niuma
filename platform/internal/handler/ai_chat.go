// 本文件实现 AI 会话与流式对话的 Bridge 入口（platform.ai.conversation.* / chat.*）。
package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/platform/internal/ai"
	"niuma/platform/internal/store"
)

// aiConversationView 是回传 Web 的会话视图。
type aiConversationView struct {
	ConversationID    string `json:"conversationId"`
	WorkspaceID       string `json:"workspaceId"`
	ConversationTitle string `json:"conversationTitle"`
	ProviderID        string `json:"providerId"`
	ModelCode         string `json:"modelCode"`
	RowVersion        int64  `json:"rowVersion"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}

// aiMessageView 是回传 Web 的消息视图。
type aiMessageView struct {
	MessageID      string `json:"messageId"`
	ConversationID string `json:"conversationId"`
	MessageRole    string `json:"messageRole"`
	MessageContent string `json:"messageContent"`
	ToolCallID     string `json:"toolCallId,omitempty"`
	TokenCount     *int64 `json:"tokenCount"`
	CreatedAt      string `json:"createdAt"`
}

// aiToolInvocationView 是回传 Web 的工具调用流水视图。
type aiToolInvocationView struct {
	InvocationID   string `json:"invocationId"`
	ConversationID string `json:"conversationId"`
	RunID          string `json:"runId"`
	ToolName       string `json:"toolName"`
	ArgsSummary    string `json:"argsSummary,omitempty"`
	RiskLevel      string `json:"risk,omitempty"`
	InvokeStatus   string `json:"status"`
	ResultSummary  string `json:"resultSummary,omitempty"`
	ErrorMessage   string `json:"error,omitempty"`
	CreatedAt      string `json:"createdAt"`
}

// toAIConversationView 将仓储会话转为 Bridge 视图。
func toAIConversationView(c store.AIConversation) aiConversationView {
	return aiConversationView{
		ConversationID:    c.ConversationID,
		WorkspaceID:       c.WorkspaceID,
		ConversationTitle: c.ConversationTitle,
		ProviderID:        c.ProviderID,
		ModelCode:         c.ModelCode,
		RowVersion:        c.RowVersion,
		CreatedAt:         c.CreatedAt,
		UpdatedAt:         c.UpdatedAt,
	}
}

// toAIMessageView 将仓储消息转为 Bridge 视图。
func toAIMessageView(m store.AIMessage) aiMessageView {
	var tokenCount *int64
	if m.TokenCount.Valid {
		v := m.TokenCount.Int64
		tokenCount = &v
	}
	return aiMessageView{
		MessageID:      m.MessageID,
		ConversationID: m.ConversationID,
		MessageRole:    m.MessageRole,
		MessageContent: m.MessageContent,
		ToolCallID:     m.ToolCallID,
		TokenCount:     tokenCount,
		CreatedAt:      m.CreatedAt,
	}
}

// toAIToolInvocationView 将工具调用流水转为 Bridge 视图（截断参数摘要）。
func toAIToolInvocationView(inv store.AIToolInvocation) aiToolInvocationView {
	args := inv.ArgumentsJSON
	if len(args) > 200 {
		args = args[:200] + "…"
	}
	status := inv.InvokeStatus
	switch status {
	case "done", "ok", "success":
		status = "ok"
	case "rejected", "cancelled":
		status = "error"
	}
	return aiToolInvocationView{
		InvocationID:   inv.InvocationID,
		ConversationID: inv.ConversationID,
		RunID:          inv.RunID,
		ToolName:       inv.ToolName,
		ArgsSummary:    args,
		RiskLevel:      inv.RiskLevel,
		InvokeStatus:   status,
		ResultSummary:  inv.ResultSummary,
		ErrorMessage:   inv.ErrorMessage,
		CreatedAt:      inv.CreatedAt,
	}
}

// requireAI 返回已装配的 AI 领域服务；未装配时为 nil。
func (d *Dispatcher) requireAI() *ai.Service {
	return d.ai
}

// aiConversationList 处理 platform.ai.conversation.list。
func (d *Dispatcher) aiConversationList(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil || svc.Conversations == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		Limit int `json:"limit"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	list, err := svc.Conversations.ListConversations(ctx, params.Limit)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	views := make([]aiConversationView, 0, len(list))
	for _, c := range list {
		views = append(views, toAIConversationView(c))
	}
	return okResponse(req.ID, map[string]any{"conversations": views})
}

// aiConversationGet 处理 platform.ai.conversation.get。
func (d *Dispatcher) aiConversationGet(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil || svc.Conversations == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ConversationID string `json:"conversationId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ConversationID == "" {
		return errorResponse(req.ID, "conversationId required")
	}
	c, err := svc.Conversations.GetConversation(ctx, params.ConversationID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if c == nil {
		return okResponse(req.ID, map[string]any{
			"conversation":    nil,
			"messages":        []aiMessageView{},
			"toolInvocations": []aiToolInvocationView{},
		})
	}
	msgs, err := svc.Conversations.ListMessages(ctx, params.ConversationID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	views := make([]aiMessageView, 0, len(msgs))
	for _, m := range msgs {
		views = append(views, toAIMessageView(m))
	}
	invs, err := svc.Conversations.ListToolInvocations(ctx, params.ConversationID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	invViews := make([]aiToolInvocationView, 0, len(invs))
	for _, inv := range invs {
		invViews = append(invViews, toAIToolInvocationView(inv))
	}
	return okResponse(req.ID, map[string]any{
		"conversation":    toAIConversationView(*c),
		"messages":        views,
		"toolInvocations": invViews,
	})
}

// aiConversationCreate 处理 platform.ai.conversation.create。
func (d *Dispatcher) aiConversationCreate(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil || svc.Conversations == nil || d.ids == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		Title      string `json:"title"`
		ProviderID string `json:"providerId"`
		ModelCode  string `json:"modelCode"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	conversationID, err := d.ids.NextString()
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if err := svc.Conversations.CreateConversation(ctx, store.AIConversation{
		ConversationID:    conversationID,
		ConversationTitle: params.Title,
		ProviderID:        params.ProviderID,
		ModelCode:         params.ModelCode,
	}); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"conversationId": conversationID})
}

// aiConversationDelete 处理 platform.ai.conversation.delete。
func (d *Dispatcher) aiConversationDelete(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil || svc.Conversations == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ConversationID string `json:"conversationId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ConversationID == "" {
		return errorResponse(req.ID, "conversationId required")
	}
	if err := svc.Conversations.DeleteConversation(ctx, params.ConversationID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"deleted": true})
}

// aiConversationUpdate 处理 platform.ai.conversation.update（当前支持重命名标题）。
func (d *Dispatcher) aiConversationUpdate(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ConversationID string `json:"conversationId"`
		Title          string `json:"title"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	title, err := svc.RenameConversation(ctx, params.ConversationID, params.Title)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"ok": true, "title": title})
}

// aiChatStream 处理 platform.ai.chat.stream：委托 ai.Service 启动流式对话。
func (d *Dispatcher) aiChatStream(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ConversationID          string           `json:"conversationId"`
		Content                 string           `json:"content"`
		ProviderID              string           `json:"providerId"`
		ModelCode               string           `json:"modelCode"`
		SkillCode               string           `json:"skillCode"`
		RegenerateFromMessageID string           `json:"regenerateFromMessageId"`
		EditFromMessageID       string           `json:"editFromMessageId"`
		Context                 *ai.ContextDraft `json:"context"`
		CloudAccessToken        string           `json:"cloudAccessToken"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	result, err := svc.StartStream(ctx, ai.StreamParams{
		ConversationID:          params.ConversationID,
		Content:                 params.Content,
		ProviderID:              params.ProviderID,
		ModelCode:               params.ModelCode,
		SkillCode:               params.SkillCode,
		RegenerateFromMessageID: params.RegenerateFromMessageID,
		EditFromMessageID:       params.EditFromMessageID,
		Context:                 params.Context,
		CloudAccessToken:        params.CloudAccessToken,
	})
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{
		"runId":          result.RunID,
		"conversationId": result.ConversationID,
		"userMessageId":  result.UserMessageID,
	})
}

// aiChatCancel 处理 platform.ai.chat.cancel。
func (d *Dispatcher) aiChatCancel(_ context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.RunID == "" {
		return errorResponse(req.ID, "runId required")
	}
	return okResponse(req.ID, map[string]any{"cancelled": svc.Cancel(params.RunID)})
}
