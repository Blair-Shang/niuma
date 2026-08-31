package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/platform/internal/ai"
	"niuma/platform/internal/store"
)

const (
	// credentialKindAPIKey 表示 LLM / MCP 的 API Key 类凭据。
	credentialKindAPIKey = "api_key"
	// aiProviderKindOpenAI 表示 OpenAI 兼容接入点。
	aiProviderKindOpenAI = "openai"
)

// aiProviderView 是回传 Web 的 Provider 视图（不含 API Key 明文）。
type aiProviderView struct {
	ProviderID       string          `json:"providerId"`
	ProviderName     string          `json:"providerName"`
	ProviderKind     string          `json:"providerKind"`
	BaseURL          string          `json:"baseUrl"`
	HasAPIKey        bool            `json:"hasApiKey"`
	DefaultModelCode string          `json:"defaultModelCode"`
	ProviderOptions  json.RawMessage `json:"providerOptions"`
	RecordStatus     string          `json:"recordStatus"`
	SortOrder        int64           `json:"sortOrder"`
	RowVersion       int64           `json:"rowVersion"`
	CreatedAt        string          `json:"createdAt"`
	UpdatedAt        string          `json:"updatedAt"`
	Models           []aiModelView   `json:"models,omitempty"`
}

// aiModelView 是回传 Web 的模型视图。
type aiModelView struct {
	ModelID         string          `json:"modelId"`
	ProviderID      string          `json:"providerId"`
	ModelCode       string          `json:"modelCode"`
	ModelLabel      string          `json:"modelLabel"`
	ContextWindow   *int64          `json:"contextWindow"`
	MaxOutputTokens *int64          `json:"maxOutputTokens"`
	ModelOptions    json.RawMessage `json:"modelOptions"`
	RecordStatus    string          `json:"recordStatus"`
	SortOrder       int64           `json:"sortOrder"`
	RowVersion      int64           `json:"rowVersion"`
	CreatedAt       string          `json:"createdAt"`
	UpdatedAt       string          `json:"updatedAt"`
}

// aiProviderInput 是 upsert Provider 的业务字段。
type aiProviderInput struct {
	ProviderName     string          `json:"providerName"`
	ProviderKind     string          `json:"providerKind"`
	BaseURL          string          `json:"baseUrl"`
	DefaultModelCode string          `json:"defaultModelCode"`
	ProviderOptions  json.RawMessage `json:"providerOptions"`
	RecordStatus     string          `json:"recordStatus"`
	SortOrder        int64           `json:"sortOrder"`
	APIKey           string          `json:"apiKey"` // 明文；空表示不更新既有密钥
}

// aiModelInput 是 upsert 模型的业务字段。
type aiModelInput struct {
	ProviderID      string          `json:"providerId"`
	ModelCode       string          `json:"modelCode"`
	ModelLabel      string          `json:"modelLabel"`
	ContextWindow   *int64          `json:"contextWindow"`
	MaxOutputTokens *int64          `json:"maxOutputTokens"`
	ModelOptions    json.RawMessage `json:"modelOptions"`
	RecordStatus    string          `json:"recordStatus"`
	SortOrder       int64           `json:"sortOrder"`
}

// toAIProviderView 把 store 实体转为视图。
func toAIProviderView(p store.AIProvider, models []aiModelView) aiProviderView {
	options := p.ProviderOptions
	if options == "" {
		options = "{}"
	}
	return aiProviderView{
		ProviderID:       p.ProviderID,
		ProviderName:     p.ProviderName,
		ProviderKind:     p.ProviderKind,
		BaseURL:          p.BaseURL,
		HasAPIKey:        strings.TrimSpace(p.CredentialID) != "" || ai.IsSystemProvider(&p),
		DefaultModelCode: p.DefaultModelCode,
		ProviderOptions:  json.RawMessage(options),
		RecordStatus:     p.RecordStatus,
		SortOrder:        p.SortOrder,
		RowVersion:       p.RowVersion,
		CreatedAt:        p.CreatedAt,
		UpdatedAt:        p.UpdatedAt,
		Models:           models,
	}
}

// toAIModelView 把 store 实体转为视图。
func toAIModelView(m store.AIModel) aiModelView {
	options := m.ModelOptions
	if options == "" {
		options = "{}"
	}
	var ctxWin, maxOut *int64
	if m.ContextWindow.Valid {
		v := m.ContextWindow.Int64
		ctxWin = &v
	}
	if m.MaxOutputTokens.Valid {
		v := m.MaxOutputTokens.Int64
		maxOut = &v
	}
	return aiModelView{
		ModelID:         m.ModelID,
		ProviderID:      m.ProviderID,
		ModelCode:       m.ModelCode,
		ModelLabel:      m.ModelLabel,
		ContextWindow:   ctxWin,
		MaxOutputTokens: maxOut,
		ModelOptions:    json.RawMessage(options),
		RecordStatus:    m.RecordStatus,
		SortOrder:       m.SortOrder,
		RowVersion:      m.RowVersion,
		CreatedAt:       m.CreatedAt,
		UpdatedAt:       m.UpdatedAt,
	}
}

// aiProviderList 处理 platform.ai.provider.list。
func (d *Dispatcher) aiProviderList(ctx context.Context, req Request) Response {
	if d.ai == nil || d.ai.Providers == nil {
		return errorResponse(req.ID, "ai provider store unavailable")
	}
	var params struct {
		Status          string `json:"status"`
		IncludeModels   bool   `json:"includeModels"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}

	providers, err := d.ai.Providers.ListProviders(ctx, params.Status)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	views := make([]aiProviderView, 0, len(providers))
	for _, p := range providers {
		var models []aiModelView
		if params.IncludeModels {
			ms, listErr := d.ai.Providers.ListModels(ctx, p.ProviderID)
			if listErr != nil {
				return errorResponse(req.ID, listErr.Error())
			}
			models = make([]aiModelView, 0, len(ms))
			for _, m := range ms {
				models = append(models, toAIModelView(m))
			}
		}
		views = append(views, toAIProviderView(p, models))
	}
	return okResponse(req.ID, map[string]any{"providers": views})
}

// aiProviderGet 处理 platform.ai.provider.get。
func (d *Dispatcher) aiProviderGet(ctx context.Context, req Request) Response {
	if d.ai == nil || d.ai.Providers == nil {
		return errorResponse(req.ID, "ai provider store unavailable")
	}
	var params struct {
		ProviderID string `json:"providerId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ProviderID == "" {
		return errorResponse(req.ID, "providerId required")
	}

	p, err := d.ai.Providers.GetProvider(ctx, params.ProviderID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if p == nil {
		return okResponse(req.ID, map[string]any{"provider": nil})
	}
	ms, err := d.ai.Providers.ListModels(ctx, p.ProviderID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	models := make([]aiModelView, 0, len(ms))
	for _, m := range ms {
		models = append(models, toAIModelView(m))
	}
	return okResponse(req.ID, map[string]any{"provider": toAIProviderView(*p, models)})
}

// aiProviderUpsert 处理 platform.ai.provider.upsert：providerId 空则新建。
func (d *Dispatcher) aiProviderUpsert(ctx context.Context, req Request) Response {
	if d.ai == nil || d.ai.Providers == nil {
		return errorResponse(req.ID, "ai provider store unavailable")
	}
	var params struct {
		ProviderID string          `json:"providerId"`
		Provider   aiProviderInput `json:"provider"`
		RowVersion int64           `json:"rowVersion"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if ai.IsSystemProviderID(params.ProviderID) {
		return errorResponse(req.ID, "system provider is read-only")
	}
	if strings.TrimSpace(params.Provider.ProviderName) == "" {
		return errorResponse(req.ID, "providerName required")
	}
	kind := params.Provider.ProviderKind
	if kind == "" {
		kind = aiProviderKindOpenAI
	}

	options := "{}"
	if len(params.Provider.ProviderOptions) > 0 {
		options = string(params.Provider.ProviderOptions)
	}

	if params.ProviderID == "" {
		providerID, err := d.ids.NextString()
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
		var credentialID string
		if strings.TrimSpace(params.Provider.APIKey) != "" {
			id, credErr := d.storeCredential(ctx, credentialInput{
				Label:  "ai-provider-" + providerID,
				Kind:   credentialKindAPIKey,
				Secret: params.Provider.APIKey,
			})
			if credErr != nil {
				return errorResponse(req.ID, credErr.Error())
			}
			credentialID = id
		}
		if err := d.ai.Providers.CreateProvider(ctx, store.AIProvider{
			ProviderID:       providerID,
			ProviderName:     params.Provider.ProviderName,
			ProviderKind:     kind,
			BaseURL:          params.Provider.BaseURL,
			CredentialID:     credentialID,
			DefaultModelCode: params.Provider.DefaultModelCode,
			ProviderOptions:  options,
			RecordStatus:     params.Provider.RecordStatus,
			SortOrder:        params.Provider.SortOrder,
		}); err != nil {
			return errorResponse(req.ID, err.Error())
		}
		return okResponse(req.ID, map[string]any{"providerId": providerID, "rowVersion": int64(0)})
	}

	existing, err := d.ai.Providers.GetProvider(ctx, params.ProviderID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if existing == nil {
		return errorResponse(req.ID, "provider not found")
	}

	credentialID := existing.CredentialID
	if strings.TrimSpace(params.Provider.APIKey) != "" {
		id, credErr := d.storeCredential(ctx, credentialInput{
			CredentialID: credentialID,
			Label:        "ai-provider-" + params.ProviderID,
			Kind:         credentialKindAPIKey,
			Secret:       params.Provider.APIKey,
		})
		if credErr != nil {
			return errorResponse(req.ID, credErr.Error())
		}
		credentialID = id
	}

	newVersion, ok, err := d.ai.Providers.UpdateProvider(ctx, store.AIProvider{
		ProviderID:       params.ProviderID,
		ProviderName:     params.Provider.ProviderName,
		ProviderKind:     kind,
		BaseURL:          params.Provider.BaseURL,
		CredentialID:     credentialID,
		DefaultModelCode: params.Provider.DefaultModelCode,
		ProviderOptions:  options,
		RecordStatus:     params.Provider.RecordStatus,
		SortOrder:        params.Provider.SortOrder,
	}, params.RowVersion)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if !ok {
		return errorResponse(req.ID, "version conflict")
	}
	return okResponse(req.ID, map[string]any{"providerId": params.ProviderID, "rowVersion": newVersion})
}

// aiProviderDelete 处理 platform.ai.provider.delete：级联删模型与专属凭据。
func (d *Dispatcher) aiProviderDelete(ctx context.Context, req Request) Response {
	if d.ai == nil || d.ai.Providers == nil {
		return errorResponse(req.ID, "ai provider store unavailable")
	}
	var params struct {
		ProviderID string `json:"providerId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ProviderID == "" {
		return errorResponse(req.ID, "providerId required")
	}
	if ai.IsSystemProviderID(params.ProviderID) {
		return errorResponse(req.ID, "system provider cannot be deleted")
	}

	existing, err := d.ai.Providers.GetProvider(ctx, params.ProviderID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if existing == nil {
		return okResponse(req.ID, map[string]any{"deleted": true})
	}

	if err := d.ai.Providers.DeleteModelsByProvider(ctx, params.ProviderID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if err := d.ai.Providers.DeleteProvider(ctx, params.ProviderID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if existing.CredentialID != "" {
		if err := d.deleteCredential(ctx, existing.CredentialID); err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	return okResponse(req.ID, map[string]any{"deleted": true})
}

// aiProviderEnsureSystem 处理 platform.ai.provider.ensureSystem：按云端目录同步本机系统 Provider。
func (d *Dispatcher) aiProviderEnsureSystem(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		Enabled          bool   `json:"enabled"`
		BaseURL          string `json:"baseUrl"`
		ProviderName     string `json:"providerName"`
		DefaultModelCode string `json:"defaultModelCode"`
		Models           []struct {
			Code  string `json:"code"`
			Label string `json:"label"`
		} `json:"models"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	specs := make([]ai.SystemModelSpec, 0, len(params.Models))
	for _, m := range params.Models {
		specs = append(specs, ai.SystemModelSpec{Code: m.Code, Label: m.Label})
	}
	result, err := svc.EnsureSystemProvider(ctx, ai.EnsureSystemParams{
		Enabled:          params.Enabled,
		BaseURL:          params.BaseURL,
		ProviderName:     params.ProviderName,
		DefaultModelCode: params.DefaultModelCode,
		Models:           specs,
	})
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{
		"providerId": result.ProviderID,
		"enabled":    result.Enabled,
	})
}

// parseAIProbeParams 解析 test / listRemoteModels 共用入参。
func parseAIProbeParams(req Request) (ai.ProbeParams, error) {
	var params struct {
		ProviderID   string `json:"providerId"`
		BaseURL      string `json:"baseUrl"`
		ProviderKind string `json:"providerKind"`
		APIKey       string `json:"apiKey"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return ai.ProbeParams{}, fmt.Errorf("invalid params: %w", err)
		}
	}
	return ai.ProbeParams{
		ProviderID:   params.ProviderID,
		BaseURL:      params.BaseURL,
		ProviderKind: params.ProviderKind,
		APIKey:       params.APIKey,
	}, nil
}

// aiProviderTest 处理 platform.ai.provider.test。
func (d *Dispatcher) aiProviderTest(ctx context.Context, req Request) Response {
	if d.ai == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	params, err := parseAIProbeParams(req)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	result, err := d.ai.TestProvider(ctx, params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

// aiProviderListRemoteModels 处理 platform.ai.provider.listRemoteModels。
func (d *Dispatcher) aiProviderListRemoteModels(ctx context.Context, req Request) Response {
	if d.ai == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	params, err := parseAIProbeParams(req)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	models, endpoint, err := d.ai.ListRemoteModels(ctx, params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{
		"models":   models,
		"endpoint": endpoint,
	})
}

// aiProviderGetApiKey 处理 platform.ai.provider.getApiKey：编辑页回填用（仅本地 IPC）。
func (d *Dispatcher) aiProviderGetApiKey(ctx context.Context, req Request) Response {
	if d.ai == nil || d.ai.Providers == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ProviderID string `json:"providerId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.ProviderID) == "" {
		return errorResponse(req.ID, "providerId required")
	}
	p, err := d.ai.Providers.GetProvider(ctx, params.ProviderID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if p == nil || strings.TrimSpace(p.CredentialID) == "" {
		return okResponse(req.ID, map[string]any{"found": false, "apiKey": ""})
	}
	_, _, secret, resolveErr := d.ai.ResolveProbeConfig(ctx, ai.ProbeParams{ProviderID: params.ProviderID})
	if resolveErr != nil {
		if strings.Contains(resolveErr.Error(), "api key not configured") {
			return okResponse(req.ID, map[string]any{"found": false, "apiKey": ""})
		}
		return errorResponse(req.ID, resolveErr.Error())
	}
	if strings.TrimSpace(secret) == "" {
		return okResponse(req.ID, map[string]any{"found": false, "apiKey": ""})
	}
	return okResponse(req.ID, map[string]any{"found": true, "apiKey": secret})
}

// aiModelList 处理 platform.ai.model.list。
func (d *Dispatcher) aiModelList(ctx context.Context, req Request) Response {
	if d.ai == nil || d.ai.Providers == nil {
		return errorResponse(req.ID, "ai provider store unavailable")
	}
	var params struct {
		ProviderID string `json:"providerId"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	ms, err := d.ai.Providers.ListModels(ctx, params.ProviderID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	views := make([]aiModelView, 0, len(ms))
	for _, m := range ms {
		views = append(views, toAIModelView(m))
	}
	return okResponse(req.ID, map[string]any{"models": views})
}

// aiModelUpsert 处理 platform.ai.model.upsert：modelId 空则新建。
func (d *Dispatcher) aiModelUpsert(ctx context.Context, req Request) Response {
	if d.ai == nil || d.ai.Providers == nil {
		return errorResponse(req.ID, "ai provider store unavailable")
	}
	var params struct {
		ModelID    string       `json:"modelId"`
		Model      aiModelInput `json:"model"`
		RowVersion int64        `json:"rowVersion"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.Model.ProviderID == "" {
		return errorResponse(req.ID, "providerId required")
	}
	if strings.TrimSpace(params.Model.ModelCode) == "" {
		return errorResponse(req.ID, "modelCode required")
	}
	label := params.Model.ModelLabel
	if label == "" {
		label = params.Model.ModelCode
	}
	options := "{}"
	if len(params.Model.ModelOptions) > 0 {
		options = string(params.Model.ModelOptions)
	}

	parent, err := d.ai.Providers.GetProvider(ctx, params.Model.ProviderID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if parent == nil {
		return errorResponse(req.ID, "provider not found")
	}
	if ai.IsSystemProvider(parent) {
		return errorResponse(req.ID, "system provider is read-only")
	}

	entity := store.AIModel{
		ProviderID:   params.Model.ProviderID,
		ModelCode:    params.Model.ModelCode,
		ModelLabel:   label,
		ModelOptions: options,
		RecordStatus: params.Model.RecordStatus,
		SortOrder:    params.Model.SortOrder,
	}
	if params.Model.ContextWindow != nil {
		entity.ContextWindow = sql.NullInt64{Int64: *params.Model.ContextWindow, Valid: true}
	}
	if params.Model.MaxOutputTokens != nil {
		entity.MaxOutputTokens = sql.NullInt64{Int64: *params.Model.MaxOutputTokens, Valid: true}
	}

	if params.ModelID == "" {
		modelID, idErr := d.ids.NextString()
		if idErr != nil {
			return errorResponse(req.ID, idErr.Error())
		}
		entity.ModelID = modelID
		if err := d.ai.Providers.CreateModel(ctx, entity); err != nil {
			return errorResponse(req.ID, err.Error())
		}
		return okResponse(req.ID, map[string]any{"modelId": modelID, "rowVersion": int64(0)})
	}

	entity.ModelID = params.ModelID
	newVersion, ok, err := d.ai.Providers.UpdateModel(ctx, entity, params.RowVersion)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if !ok {
		return errorResponse(req.ID, "version conflict")
	}
	return okResponse(req.ID, map[string]any{"modelId": params.ModelID, "rowVersion": newVersion})
}

// aiModelDelete 处理 platform.ai.model.delete。
func (d *Dispatcher) aiModelDelete(ctx context.Context, req Request) Response {
	if d.ai == nil || d.ai.Providers == nil {
		return errorResponse(req.ID, "ai provider store unavailable")
	}
	var params struct {
		ModelID string `json:"modelId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ModelID == "" {
		return errorResponse(req.ID, "modelId required")
	}
	if err := d.ai.Providers.DeleteModel(ctx, params.ModelID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"deleted": true})
}
