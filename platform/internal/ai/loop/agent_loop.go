package loop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"niuma/platform/internal/ai/host"
	"niuma/platform/internal/ai/mcp"
	"niuma/platform/internal/ai/tool"
	"niuma/platform/internal/store"
)

const (
	MessageRoleTool = "tool"

	maxToolResultBytes = 16 * 1024
)

var nonToolNameRe = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

type boundTool struct {
	ExposeName string // 给模型的名称（可能带 server 前缀）
	HostName   string // 非空表示官方 host 工具
	Server     store.AIMCPServer
	Tool       store.AIMCPTool
}

// buildEnabledToolDefs 读取官方 host + 已启用 MCP 工具并生成 OpenAI tools + 名称映射。
// moduleID 用于按当前页签挑选 sql_* / ssh_*，避免 SSH 会话误暴露查库工具。
func (s *Service) buildEnabledToolDefs(ctx context.Context, moduleID string) ([]ToolDef, map[string]boundTool, error) {
	if s == nil {
		return nil, nil, nil
	}
	defs := make([]ToolDef, 0, 8)
	bound := make(map[string]boundTool)

	if s.host != nil {
		for _, spec := range host.HostToolSpecs(moduleID) {
			serverID := host.SpecServerID(spec)
			defs = append(defs, ToolDef{
				Type: "function",
				Function: ToolFunctionDef{
					Name:        spec.Name,
					Description: spec.Description,
					Parameters:  spec.Parameters,
				},
			})
			bound[spec.Name] = boundTool{
				ExposeName: spec.Name,
				HostName:   spec.Name,
				Tool: store.AIMCPTool{
					ServerID:        serverID,
					ToolName:        spec.Name,
					ToolDescription: spec.Description,
					InputSchema:     string(spec.Parameters),
					RiskLevel:       spec.Risk,
				},
				Server: store.AIMCPServer{ServerID: serverID, ServerName: serverID},
			}
		}
	}

	if s.MCP == nil {
		return defs, bound, nil
	}
	tools, err := s.MCP.ListEnabledTools(ctx)
	if err != nil {
		return nil, nil, err
	}
	if len(tools) == 0 {
		return defs, bound, nil
	}
	servers := make(map[string]store.AIMCPServer)
	list, err := s.MCP.ListServers(ctx, "active")
	if err != nil {
		return nil, nil, err
	}
	for _, srv := range list {
		servers[srv.ServerID] = srv
	}

	// 检测重名（含官方 host）
	nameCount := map[string]int{}
	for name := range bound {
		nameCount[name]++
	}
	for _, t := range tools {
		if s.host != nil && t.ServerID == mcp.BuiltinMCPVastbaseReadonlyID {
			continue
		}
		nameCount[t.ToolName]++
	}

	for _, t := range tools {
		if s.host != nil && t.ServerID == mcp.BuiltinMCPVastbaseReadonlyID {
			continue
		}
		srv, ok := servers[t.ServerID]
		if !ok {
			continue
		}
		expose := t.ToolName
		if nameCount[t.ToolName] > 1 || bound[t.ToolName].HostName != "" {
			expose = sanitizeToolPrefix(srv.ServerName) + "__" + t.ToolName
		}
		schema := json.RawMessage(t.InputSchema)
		if len(schema) == 0 || !json.Valid(schema) {
			schema = json.RawMessage(`{"type":"object","properties":{}}`)
		}
		defs = append(defs, ToolDef{
			Type: "function",
			Function: ToolFunctionDef{
				Name:        expose,
				Description: firstNonEmpty(t.ToolDescription, t.ToolTitle, t.ToolName),
				Parameters:  schema,
			},
		})
		bound[expose] = boundTool{ExposeName: expose, Server: srv, Tool: t}
	}
	return defs, bound, nil
}

func sanitizeToolPrefix(name string) string {
	s := nonToolNameRe.ReplaceAllString(strings.TrimSpace(name), "_")
	if s == "" {
		return "mcp"
	}
	if s[0] >= '0' && s[0] <= '9' {
		s = "s_" + s
	}
	return s
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func (s *Service) runChatStream(
	ctx context.Context,
	runID, conversationID string,
	provider *store.AIProvider,
	apiKey, modelCode string,
	history []store.AIMessage,
	normalized NormalizedContext,
	skillPrompt string,
) {
	defer s.runs.remove(runID)

	messages := AssembleMessages(history, normalized, skillPrompt)
	moduleID := ""
	if normalized.Workspace != nil {
		moduleID = normalized.Workspace.ModuleID
	}
	toolDefs, bound, err := s.buildEnabledToolDefs(ctx, moduleID)
	if err != nil {
		s.publishRunError(runID, conversationID, err)
		return
	}

	var lastContent string
	// 不限制工具轮次：模型持续 tool_calls 直到无调用或用户取消（ctx）。
	for {
		if err := ctx.Err(); err != nil {
			s.publishRunStatus(runID, conversationID, "cancelled", err.Error())
			return
		}

		result, streamErr := StreamOpenAICompatible(ctx, StreamRequest{
			BaseURL:  provider.BaseURL,
			APIKey:   apiKey,
			Kind:     provider.ProviderKind,
			Model:    modelCode,
			Messages: messages,
			Tools:    toolDefs,
		}, func(delta string) error {
			s.publish(map[string]any{
				"type":           "platform.ai.token",
				"runId":          runID,
				"conversationId": conversationID,
				"delta":          delta,
			})
			return nil
		})
		if streamErr != nil {
			status := "error"
			if errorsIsCanceled(streamErr) {
				status = "cancelled"
			}
			s.publishRunStatus(runID, conversationID, status, streamErr.Error())
			return
		}
		if result == nil {
			s.publishRunError(runID, conversationID, fmt.Errorf("ai: empty stream result"))
			return
		}
		lastContent = result.Content

		if len(result.ToolCalls) == 0 {
			s.finishAssistant(ctx, runID, conversationID, provider, modelCode, lastContent)
			return
		}

		// 将本轮 assistant（含 tool_calls）加入上下文
		messages = append(messages, ChatMessage{
			Role:      MessageRoleAssistant,
			Content:   result.Content,
			ToolCalls: result.ToolCalls,
		})

		for _, tc := range result.ToolCalls {
			toolResult, invErr := s.invokeBoundTool(ctx, runID, conversationID, normalized, bound, tc)
			if invErr != nil {
				toolResult = "ERROR: " + invErr.Error()
			}
			toolResult = truncateToolResult(toolResult)
			messages = append(messages, ChatMessage{
				Role:       MessageRoleTool,
				ToolCallID: tc.ID,
				Content:    toolResult,
				Name:       tc.Function.Name,
			})
			// 落库 tool 消息（便于面板/审计；下轮 Assemble 仍以 user/assistant 为主）
			msgID, idErr := s.ids.NextString()
			if idErr == nil {
				_ = s.Conversations.AppendMessage(context.Background(), store.AIMessage{
					MessageID:      msgID,
					ConversationID: conversationID,
					MessageRole:    MessageRoleTool,
					MessageContent: toolResult,
					ToolCallID:     tc.ID,
				})
			}
		}
	}
}

func (s *Service) invokeBoundTool(
	ctx context.Context,
	runID, conversationID string,
	normalized NormalizedContext,
	bound map[string]boundTool,
	tc ToolCall,
) (string, error) {
	b, ok := bound[tc.Function.Name]
	if !ok {
		return "", fmt.Errorf("unknown tool %q", tc.Function.Name)
	}
	args := mergeWorkspaceArgs(tc.Function.Arguments, normalized)
	argsSummary := truncateUTF8(string(args), 200)
	risk := tool.ResolveToolRisk(b.Tool.RiskLevel, b.Tool.ToolName)

	invocationID, err := s.ids.NextString()
	if err != nil {
		return "", err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	initialStatus := "running"
	if tool.RequiresConfirm(risk) {
		initialStatus = "pending"
	}
	_ = s.Conversations.UpsertToolInvocation(context.Background(), store.AIToolInvocation{
		InvocationID:   invocationID,
		ConversationID: conversationID,
		RunID:          runID,
		ServerID:       b.Server.ServerID,
		ToolName:       b.Tool.ToolName,
		ArgumentsJSON:  string(args),
		RiskLevel:      risk,
		InvokeStatus:   initialStatus,
		CreatedAt:      now,
		UpdatedAt:      now,
	})

	if tool.RequiresConfirm(risk) {
		s.publish(map[string]any{
			"type":           "platform.ai.tool.pending",
			"runId":          runID,
			"conversationId": conversationID,
			"invocationId":   invocationID,
			"toolName":       b.Tool.ToolName,
			"argsSummary":    argsSummary,
			"risk":           risk,
		})
		ch := s.policy.Register(invocationID, runID)
		select {
		case approve := <-ch:
			if !approve {
				errMsg := "rejected by user"
				result := "ERROR: " + errMsg
				_ = s.Conversations.UpdateToolInvocation(context.Background(), invocationID, "rejected", "", errMsg)
				s.publish(map[string]any{
					"type":           "platform.ai.tool.result",
					"runId":          runID,
					"conversationId": conversationID,
					"invocationId":   invocationID,
					"ok":             false,
					"resultSummary":  result,
					"error":          errMsg,
				})
				return result, fmt.Errorf("%s", errMsg)
			}
		case <-ctx.Done():
			s.policy.Cancel(invocationID)
			errMsg := "cancelled"
			result := "ERROR: " + errMsg
			_ = s.Conversations.UpdateToolInvocation(context.Background(), invocationID, "cancelled", "", errMsg)
			s.publish(map[string]any{
				"type":           "platform.ai.tool.result",
				"runId":          runID,
				"conversationId": conversationID,
				"invocationId":   invocationID,
				"ok":             false,
				"resultSummary":  result,
				"error":          errMsg,
			})
			return result, ctx.Err()
		}
		_ = s.Conversations.UpdateToolInvocation(context.Background(), invocationID, "running", "", "")
	}

	s.publish(map[string]any{
		"type":           "platform.ai.tool.start",
		"runId":          runID,
		"conversationId": conversationID,
		"invocationId":   invocationID,
		"toolName":       b.Tool.ToolName,
		"argsSummary":    argsSummary,
		"risk":           risk,
	})

	var result string
	var callErr error
	if b.HostName != "" {
		var argMap map[string]any
		if err := json.Unmarshal(args, &argMap); err != nil {
			argMap = map[string]any{}
		}
		result, callErr = host.Call(ctx, s.host, b.HostName, argMap)
	} else {
		bearer := s.mcpBearerToken(b.Server.CredentialID)
		switch b.Server.TransportKind {
		case "stdio":
			result, callErr = mcp.CallMCPToolStdio(ctx, b.Server.CommandPath, b.Server.LaunchOptions, b.Tool.ToolName, args)
		case "streamable_http":
			result, callErr = mcp.CallMCPToolHTTP(ctx, b.Server.EndpointURL, b.Server.LaunchOptions, bearer, b.Tool.ToolName, args)
		default:
			callErr = fmt.Errorf("mcp invoke not implemented for transport %q", b.Server.TransportKind)
		}
	}

	status := "done"
	errMsg := ""
	okFlag := true
	if callErr != nil {
		status = "error"
		errMsg = callErr.Error()
		okFlag = false
		result = "ERROR: " + errMsg
	}
	summary := truncateUTF8(result, 400)
	_ = s.Conversations.UpdateToolInvocation(context.Background(), invocationID, status, summary, errMsg)

	s.publish(map[string]any{
		"type":           "platform.ai.tool.result",
		"runId":          runID,
		"conversationId": conversationID,
		"invocationId":   invocationID,
		"ok":             okFlag,
		"resultSummary":  summary,
		"error":          errMsg,
	})
	if callErr != nil {
		return result, callErr
	}
	return result, nil
}

func mergeWorkspaceArgs(rawArgs string, normalized NormalizedContext) json.RawMessage {
	rawArgs = strings.TrimSpace(rawArgs)
	if rawArgs == "" {
		rawArgs = "{}"
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(rawArgs), &obj); err != nil || obj == nil {
		obj = map[string]any{}
	}
	if normalized.Workspace != nil {
		if _, ok := obj["profileId"]; !ok && normalized.Workspace.ProfileID != "" {
			obj["profileId"] = normalized.Workspace.ProfileID
		}
		if _, ok := obj["sessionId"]; !ok && normalized.Workspace.SessionID != "" {
			obj["sessionId"] = normalized.Workspace.SessionID
		}
		if _, ok := obj["moduleId"]; !ok && normalized.Workspace.ModuleID != "" {
			obj["moduleId"] = normalized.Workspace.ModuleID
		}
		if _, ok := obj["database"]; !ok && normalized.Workspace.Database != "" {
			obj["database"] = normalized.Workspace.Database
		}
		if _, ok := obj["schema"]; !ok && normalized.Workspace.Schema != "" {
			obj["schema"] = normalized.Workspace.Schema
		}
		if cwd := strings.TrimSpace(normalized.Workspace.Cwd); cwd != "" {
			if _, ok := obj["cwd"]; !ok {
				obj["cwd"] = cwd
			}
			if _, ok := obj["path"]; !ok {
				obj["path"] = cwd
			}
		}
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return json.RawMessage(rawArgs)
	}
	return b
}

func truncateToolResult(s string) string {
	cut, _ := truncateBytes(s, maxToolResultBytes)
	if len(cut) < len(s) {
		return cut + "\n…[truncated]"
	}
	return cut
}

func (s *Service) finishAssistant(_ context.Context, runID, conversationID string, provider *store.AIProvider, modelCode, content string) {
	assistantID, idErr := s.ids.NextString()
	if idErr != nil {
		s.publishRunError(runID, conversationID, idErr)
		return
	}
	if err := s.Conversations.AppendMessage(context.Background(), store.AIMessage{
		MessageID:      assistantID,
		ConversationID: conversationID,
		MessageRole:    MessageRoleAssistant,
		MessageContent: content,
	}); err != nil {
		s.publishRunError(runID, conversationID, err)
		return
	}
	_ = s.Conversations.TouchConversation(context.Background(), conversationID, "", provider.ProviderID, modelCode)
	s.publish(map[string]any{
		"type":           "platform.ai.message",
		"runId":          runID,
		"conversationId": conversationID,
		"messageId":      assistantID,
		"role":           MessageRoleAssistant,
		"content":        content,
	})
	s.publishRunStatus(runID, conversationID, "done", "")
}

func (s *Service) publishRunError(runID, conversationID string, err error) {
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	s.publishRunStatus(runID, conversationID, "error", msg)
}

func (s *Service) publishRunStatus(runID, conversationID, status, errMsg string) {
	ev := map[string]any{
		"type":           "platform.ai.run.status",
		"runId":          runID,
		"conversationId": conversationID,
		"status":         status,
	}
	if errMsg != "" {
		ev["error"] = errMsg
	}
	s.publish(ev)
}

func errorsIsCanceled(err error) bool {
	return errors.Is(err, context.Canceled)
}
