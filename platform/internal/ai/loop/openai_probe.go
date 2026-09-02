package loop

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

const (
	// probeHTTPTimeout 是连通性探测 / 拉取模型列表的超时。
	probeHTTPTimeout = 30 * time.Second
)

// ProbeParams 是 Provider 连通探测与远程模型列表的入参。
//
// 可只传表单字段（未保存前），或传 providerId 从 Vault 取已存密钥；
// apiKey 非空时优先使用（用于新建/改密钥后立即探测）。
type ProbeParams struct {
	ProviderID   string
	BaseURL      string
	ProviderKind string
	APIKey       string
}

// RemoteModel 是上游 /models 返回的条目（仅 id，不落敏感字段）。
type RemoteModel struct {
	ID string `json:"id"`
}

// TestResult 是连通探测结果。
type TestResult struct {
	OK         bool   `json:"ok"`
	LatencyMs  int64  `json:"latencyMs"`
	ModelCount int    `json:"modelCount"`
	Endpoint   string `json:"endpoint"`
	Message    string `json:"message"`
}

// ResolveProbeConfig 合并表单与已存 Provider，解析出 BaseURL / Kind / API Key。
func (s *Service) ResolveProbeConfig(ctx context.Context, params ProbeParams) (baseURL, kind, apiKey string, err error) {
	if s == nil {
		return "", "", "", fmt.Errorf("ai: service unavailable")
	}
	baseURL = strings.TrimSpace(params.BaseURL)
	kind = strings.TrimSpace(params.ProviderKind)
	apiKey = strings.TrimSpace(params.APIKey)

	if strings.TrimSpace(params.ProviderID) != "" {
		if s.Providers == nil {
			return "", "", "", fmt.Errorf("ai: provider store unavailable")
		}
		p, getErr := s.Providers.GetProvider(ctx, params.ProviderID)
		if getErr != nil {
			return "", "", "", getErr
		}
		if p == nil {
			return "", "", "", fmt.Errorf("ai: provider not found")
		}
		if baseURL == "" {
			baseURL = p.BaseURL
		}
		if kind == "" {
			kind = p.ProviderKind
		}
		if apiKey == "" {
			resolved, keyErr := s.loadAPIKeyByCredential(p.CredentialID, p.ProviderKind)
			if keyErr != nil {
				return "", "", "", keyErr
			}
			apiKey = resolved
		}
	}

	if kind == "" {
		kind = "openai"
	}
	return baseURL, kind, apiKey, nil
}

// ListRemoteModels 调用 OpenAI 兼容 GET /models，返回模型 id 列表。
func (s *Service) ListRemoteModels(ctx context.Context, params ProbeParams) ([]RemoteModel, string, error) {
	baseURL, kind, apiKey, err := s.ResolveProbeConfig(ctx, params)
	if err != nil {
		return nil, "", err
	}
	endpoint := resolveModelsURL(baseURL, kind)
	ids, err := fetchOpenAIModelIDs(ctx, endpoint, apiKey)
	if err != nil {
		return nil, endpoint, err
	}
	out := make([]RemoteModel, 0, len(ids))
	for _, id := range ids {
		out = append(out, RemoteModel{ID: id})
	}
	return out, endpoint, nil
}

// TestProvider 通过拉取 /models 验证接入地址与 API Key。
func (s *Service) TestProvider(ctx context.Context, params ProbeParams) (*TestResult, error) {
	baseURL, kind, apiKey, err := s.ResolveProbeConfig(ctx, params)
	if err != nil {
		return nil, err
	}
	endpoint := resolveModelsURL(baseURL, kind)
	start := time.Now()
	ids, err := fetchOpenAIModelIDs(ctx, endpoint, apiKey)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return &TestResult{
			OK:        false,
			LatencyMs: latency,
			Endpoint:  endpoint,
			Message:   err.Error(),
		}, nil
	}
	return &TestResult{
		OK:         true,
		LatencyMs:  latency,
		ModelCount: len(ids),
		Endpoint:   endpoint,
		Message:    "ok",
	}, nil
}

func (s *Service) loadAPIKeyByCredential(credentialID, kind string) (string, error) {
	if strings.TrimSpace(credentialID) == "" {
		if strings.EqualFold(kind, "ollama") {
			return "", nil
		}
		return "", fmt.Errorf("ai: api key not configured")
	}
	if s.secrets == nil {
		return "", fmt.Errorf("ai: secret store unavailable")
	}
	secret, ok, err := s.secrets.GetSecret(credentialServicePrefix+credentialID, credentialSecretAccount)
	if err != nil {
		return "", err
	}
	if !ok || strings.TrimSpace(secret) == "" {
		if strings.EqualFold(kind, "ollama") {
			return "", nil
		}
		return "", fmt.Errorf("ai: api key not configured")
	}
	return secret, nil
}

// resolveModelsURL 根据 baseURL / kind 组装 GET /models 地址。
func resolveModelsURL(baseURL, kind string) string {
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
	if strings.HasSuffix(base, "/models") {
		return base
	}
	if strings.HasSuffix(base, "/chat/completions") {
		return strings.TrimSuffix(base, "/chat/completions") + "/models"
	}
	if strings.HasSuffix(base, "/v1") {
		return base + "/models"
	}
	return base + "/v1/models"
}

func fetchOpenAIModelIDs(ctx context.Context, endpoint, apiKey string) ([]string, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("ai: new models request: %w", err)
	}
	if strings.TrimSpace(apiKey) != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	client := &http.Client{Timeout: probeHTTPTimeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("ai: models http: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ai: models http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("ai: decode models: %w", err)
	}
	ids := make([]string, 0, len(parsed.Data))
	seen := make(map[string]struct{}, len(parsed.Data))
	for _, item := range parsed.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids, nil
}
