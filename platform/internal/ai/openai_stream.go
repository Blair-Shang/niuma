package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	// defaultOpenAIBaseURL 是 OpenAI 官方兼容端点前缀。
	defaultOpenAIBaseURL = "https://api.openai.com/v1"
	// defaultOllamaBaseURL 是本机 Ollama OpenAI 兼容端点。
	defaultOllamaBaseURL = "http://127.0.0.1:11434/v1"
	// llmHTTPTimeout 是单次对话 HTTP 客户端超时。
	llmHTTPTimeout = 5 * time.Minute
)

// ToolFunctionDef 是暴露给模型的 function 定义。
type ToolFunctionDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
}

// ToolDef 是 OpenAI tools[] 一项。
type ToolDef struct {
	Type     string          `json:"type"`
	Function ToolFunctionDef `json:"function"`
}

// ToolCallFunction 是 tool_call.function。
type ToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// ToolCall 是模型发起的一次工具调用。
type ToolCall struct {
	ID       string           `json:"id"`
	Type     string           `json:"type"`
	Function ToolCallFunction `json:"function"`
}

// ChatMessage 是发给模型的一条消息。
// Content 为 string（纯文本）或 []ContentPart（Vision 多模态）。
type ChatMessage struct {
	Role       string     `json:"role"`
	Content    any        `json:"content,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	Name       string     `json:"name,omitempty"`
}

// ContentPart 是 OpenAI 多模态 content[] 一项。
type ContentPart struct {
	Type     string        `json:"type"`
	Text     string        `json:"text,omitempty"`
	ImageURL *ImageURLPart `json:"image_url,omitempty"`
}

// ImageURLPart 是 image_url 结构。
type ImageURLPart struct {
	URL string `json:"url"`
}

// StreamRequest 是 OpenAI 兼容流式对话请求。
type StreamRequest struct {
	BaseURL  string
	APIKey   string
	Kind     string
	Model    string
	Messages []ChatMessage
	Tools    []ToolDef
}

// StreamRoundResult 是一轮流式调用的结果（文本和/或 tool_calls）。
type StreamRoundResult struct {
	Content      string
	ToolCalls    []ToolCall
	FinishReason string
}

// TokenHandler 在收到增量文本时回调。
type TokenHandler func(delta string) error

// StreamOpenAICompatible 调用 OpenAI 兼容 /chat/completions 流式接口。
//
// 支持 tools；取消 ctx 会中断 HTTP 读取。
func StreamOpenAICompatible(ctx context.Context, req StreamRequest, onToken TokenHandler) (*StreamRoundResult, error) {
	if strings.TrimSpace(req.Model) == "" {
		return nil, fmt.Errorf("ai: model required")
	}
	endpoint := resolveChatCompletionsURL(req.BaseURL, req.Kind)
	body := map[string]any{
		"model":    req.Model,
		"messages": req.Messages,
		"stream":   true,
	}
	if len(req.Tools) > 0 {
		body["tools"] = req.Tools
		body["tool_choice"] = "auto"
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("ai: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("ai: new request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(req.APIKey) != "" {
		httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)
	}

	client := &http.Client{Timeout: llmHTTPTimeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ai: http do: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("ai: llm http %d: %s", resp.StatusCode, strings.TrimSpace(string(errBody)))
	}

	var full strings.Builder
	acc := newToolCallAccumulator()
	finishReason := ""
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return &StreamRoundResult{Content: full.String(), ToolCalls: acc.calls(), FinishReason: finishReason}, err
		}
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}
		delta, reason, parseErr := parseOpenAIStreamChunk(data)
		if parseErr != nil {
			continue
		}
		if reason != "" {
			finishReason = reason
		}
		if delta.Content != "" {
			full.WriteString(delta.Content)
			if onToken != nil {
				if err := onToken(delta.Content); err != nil {
					return &StreamRoundResult{Content: full.String(), ToolCalls: acc.calls(), FinishReason: finishReason}, err
				}
			}
		}
		for _, tc := range delta.ToolCalls {
			acc.apply(tc)
		}
	}
	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return &StreamRoundResult{Content: full.String(), ToolCalls: acc.calls(), FinishReason: finishReason}, ctx.Err()
		}
		return nil, fmt.Errorf("ai: read stream: %w", err)
	}
	out := &StreamRoundResult{
		Content:      full.String(),
		ToolCalls:    acc.calls(),
		FinishReason: finishReason,
	}
	return out, nil
}

// resolveChatCompletionsURL 根据 baseURL / provider kind 组装 chat/completions 地址。
func resolveChatCompletionsURL(baseURL, kind string) string {
	base := strings.TrimSpace(baseURL)
	if base == "" {
		switch strings.ToLower(kind) {
		case "ollama":
			base = defaultOllamaBaseURL
		default:
			base = defaultOpenAIBaseURL
		}
	}
	base = strings.TrimRight(base, "/")
	if strings.HasSuffix(base, "/chat/completions") {
		return base
	}
	if strings.HasSuffix(base, "/v1") {
		return base + "/chat/completions"
	}
	return base + "/v1/chat/completions"
}

type openAIStreamToolCallDelta struct {
	Index    int    `json:"index"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function *struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type openAIStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content   string                     `json:"content"`
			ToolCalls []openAIStreamToolCallDelta `json:"tool_calls"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

type streamDelta struct {
	Content   string
	ToolCalls []openAIStreamToolCallDelta
}

func parseOpenAIStreamChunk(data string) (streamDelta, string, error) {
	var chunk openAIStreamChunk
	if err := json.Unmarshal([]byte(data), &chunk); err != nil {
		return streamDelta{}, "", err
	}
	if len(chunk.Choices) == 0 {
		return streamDelta{}, "", nil
	}
	c0 := chunk.Choices[0]
	reason := ""
	if c0.FinishReason != nil {
		reason = *c0.FinishReason
	}
	return streamDelta{Content: c0.Delta.Content, ToolCalls: c0.Delta.ToolCalls}, reason, nil
}

// parseOpenAIStreamDelta 保留给旧测试：仅提取 content。
func parseOpenAIStreamDelta(data string) (string, error) {
	d, _, err := parseOpenAIStreamChunk(data)
	return d.Content, err
}

type toolCallAccumulator struct {
	byIndex map[int]*ToolCall
	order   []int
}

func newToolCallAccumulator() *toolCallAccumulator {
	return &toolCallAccumulator{byIndex: make(map[int]*ToolCall)}
}

func (a *toolCallAccumulator) apply(d openAIStreamToolCallDelta) {
	tc, ok := a.byIndex[d.Index]
	if !ok {
		tc = &ToolCall{Type: "function"}
		a.byIndex[d.Index] = tc
		a.order = append(a.order, d.Index)
	}
	if d.ID != "" {
		tc.ID = d.ID
	}
	if d.Type != "" {
		tc.Type = d.Type
	}
	if d.Function != nil {
		if d.Function.Name != "" {
			tc.Function.Name = d.Function.Name
		}
		if d.Function.Arguments != "" {
			tc.Function.Arguments += d.Function.Arguments
		}
	}
}

func (a *toolCallAccumulator) calls() []ToolCall {
	if len(a.order) == 0 {
		return nil
	}
	out := make([]ToolCall, 0, len(a.order))
	for _, idx := range a.order {
		tc := a.byIndex[idx]
		if tc == nil || tc.Function.Name == "" {
			continue
		}
		if tc.Type == "" {
			tc.Type = "function"
		}
		out = append(out, *tc)
	}
	return out
}
