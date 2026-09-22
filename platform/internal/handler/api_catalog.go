package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/platform/internal/store"
)

const (
	// MethodAPIEnvironmentList 列出工作区环境。
	MethodAPIEnvironmentList = "platform.api.environment.list"
	// MethodAPIEnvironmentCreate 新建环境。
	MethodAPIEnvironmentCreate = "platform.api.environment.create"
	// MethodAPIEnvironmentUpdate 更新环境。
	MethodAPIEnvironmentUpdate = "platform.api.environment.update"
	// MethodAPIEnvironmentDelete 删除环境及其变量。
	MethodAPIEnvironmentDelete = "platform.api.environment.delete"

	// MethodAPIVariableList 列出变量。
	MethodAPIVariableList = "platform.api.variable.list"
	// MethodAPIVariableUpsert 插入或更新单条变量。
	MethodAPIVariableUpsert = "platform.api.variable.upsert"
	// MethodAPIVariableDelete 删除单条变量。
	MethodAPIVariableDelete = "platform.api.variable.delete"
	// MethodAPIVariableReplaceScope 替换某 scope 下全部变量。
	MethodAPIVariableReplaceScope = "platform.api.variable.replaceScope"
)

type apiEnvironmentListParams struct {
	WorkspaceID string `json:"workspaceId"`
}

type apiEnvironmentCreateParams struct {
	WorkspaceID     string `json:"workspaceId"`
	EnvironmentID   string `json:"environmentId"`
	EnvironmentName string `json:"environmentName"`
	BaseURL         string `json:"baseUrl"`
}

type apiEnvironmentUpdateParams struct {
	EnvironmentID   string `json:"environmentId"`
	EnvironmentName string `json:"environmentName"`
	BaseURL         string `json:"baseUrl"`
}

type apiEnvironmentDeleteParams struct {
	EnvironmentID string `json:"environmentId"`
}

type apiVariableListParams struct {
	WorkspaceID   string `json:"workspaceId"`
	VariableScope string `json:"variableScope"`
	ScopeRefID    string `json:"scopeRefId"`
}

type apiVariableUpsertParams struct {
	WorkspaceID   string          `json:"workspaceId"`
	VariableID    string          `json:"variableId"`
	VariableScope string          `json:"variableScope"`
	ScopeRefID    string          `json:"scopeRefId"`
	VariableName  string          `json:"variableName"`
	VariableKind  string          `json:"variableKind"`
	InitialValue  string          `json:"initialValue"`
	CurrentValue  string          `json:"currentValue"`
	MetaJSON      json.RawMessage `json:"metaJson"`
	SortOrder     int64           `json:"sortOrder"`
}

type apiVariableDeleteParams struct {
	VariableID string `json:"variableId"`
}

type apiVariableReplaceScopeParams struct {
	WorkspaceID   string                `json:"workspaceId"`
	VariableScope string                `json:"variableScope"`
	ScopeRefID    string                `json:"scopeRefId"`
	Variables     []apiVariableUpsertParams `json:"variables"`
}

type apiEnvironmentView struct {
	EnvironmentID   string `json:"environmentId"`
	WorkspaceID     string `json:"workspaceId"`
	EnvironmentName string `json:"environmentName"`
	BaseURL         string `json:"baseUrl"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

type apiVariableView struct {
	VariableID    string          `json:"variableId"`
	WorkspaceID   string          `json:"workspaceId"`
	VariableScope string          `json:"variableScope"`
	ScopeRefID    string          `json:"scopeRefId"`
	VariableName  string          `json:"variableName"`
	VariableKind  string          `json:"variableKind"`
	InitialValue  string          `json:"initialValue"`
	CurrentValue  string          `json:"currentValue"`
	MetaJSON      json.RawMessage `json:"metaJson"`
	SortOrder     int64           `json:"sortOrder"`
	CreatedAt     string          `json:"createdAt"`
	UpdatedAt     string          `json:"updatedAt"`
}

func (d *Dispatcher) requireAPICatalog() *store.APICatalogStore {
	return d.apiCatalog
}

func toAPIEnvironmentView(rec store.APIEnvironmentRecord) apiEnvironmentView {
	return apiEnvironmentView{
		EnvironmentID:   rec.EnvironmentID,
		WorkspaceID:     rec.WorkspaceID,
		EnvironmentName: rec.EnvironmentName,
		BaseURL:         rec.BaseURL,
		CreatedAt:       rec.CreatedAt,
		UpdatedAt:       rec.UpdatedAt,
	}
}

func toAPIVariableView(rec store.APIVariableRecord) apiVariableView {
	return apiVariableView{
		VariableID:    rec.VariableID,
		WorkspaceID:   rec.WorkspaceID,
		VariableScope: rec.VariableScope,
		ScopeRefID:    rec.ScopeRefID,
		VariableName:  rec.VariableName,
		VariableKind:  rec.VariableKind,
		InitialValue:  rec.InitialValue,
		CurrentValue:  rec.CurrentValue,
		MetaJSON:      json.RawMessage(orJSONObject(rec.MetaJSON)),
		SortOrder:     rec.SortOrder,
		CreatedAt:     rec.CreatedAt,
		UpdatedAt:     rec.UpdatedAt,
	}
}

func paramsToVariableRecord(params apiVariableUpsertParams) store.APIVariableRecord {
	return store.APIVariableRecord{
		VariableID:    strings.TrimSpace(params.VariableID),
		WorkspaceID:   params.WorkspaceID,
		VariableScope: params.VariableScope,
		ScopeRefID:    params.ScopeRefID,
		VariableName:  params.VariableName,
		VariableKind:  params.VariableKind,
		InitialValue:  params.InitialValue,
		CurrentValue:  params.CurrentValue,
		MetaJSON:      string(params.MetaJSON),
		SortOrder:     params.SortOrder,
	}
}

// apiEnvironmentList 处理 platform.api.environment.list。
func (d *Dispatcher) apiEnvironmentList(ctx context.Context, req Request) Response {
	storeRef := d.requireAPICatalog()
	if storeRef == nil {
		return errorResponse(req.ID, "api catalog store unavailable")
	}
	var params apiEnvironmentListParams
	if len(req.Params) > 0 && string(req.Params) != "null" {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	list, err := storeRef.ListEnvironments(ctx, params.WorkspaceID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	views := make([]apiEnvironmentView, 0, len(list))
	for _, rec := range list {
		views = append(views, toAPIEnvironmentView(rec))
	}
	return okResponse(req.ID, map[string]any{"environments": views})
}

// apiEnvironmentCreate 处理 platform.api.environment.create。
func (d *Dispatcher) apiEnvironmentCreate(ctx context.Context, req Request) Response {
	storeRef := d.requireAPICatalog()
	if storeRef == nil || d.ids == nil {
		return errorResponse(req.ID, "api catalog store unavailable")
	}
	var params apiEnvironmentCreateParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	environmentID := strings.TrimSpace(params.EnvironmentID)
	if environmentID == "" {
		var err error
		environmentID, err = d.ids.NextString()
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	name := strings.TrimSpace(params.EnvironmentName)
	if name == "" {
		return errorResponse(req.ID, "environmentName required")
	}
	rec, err := storeRef.CreateEnvironment(ctx, store.APIEnvironmentRecord{
		EnvironmentID:   environmentID,
		WorkspaceID:     params.WorkspaceID,
		EnvironmentName: name,
		BaseURL:         strings.TrimSpace(params.BaseURL),
	})
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"environment": toAPIEnvironmentView(rec)})
}

// apiEnvironmentUpdate 处理 platform.api.environment.update。
func (d *Dispatcher) apiEnvironmentUpdate(ctx context.Context, req Request) Response {
	storeRef := d.requireAPICatalog()
	if storeRef == nil {
		return errorResponse(req.ID, "api catalog store unavailable")
	}
	var params apiEnvironmentUpdateParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.EnvironmentID) == "" {
		return errorResponse(req.ID, "environmentId required")
	}
	rec, err := storeRef.UpdateEnvironment(ctx, store.APIEnvironmentRecord{
		EnvironmentID:   params.EnvironmentID,
		EnvironmentName: params.EnvironmentName,
		BaseURL:         strings.TrimSpace(params.BaseURL),
	})
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"environment": toAPIEnvironmentView(rec)})
}

// apiEnvironmentDelete 处理 platform.api.environment.delete。
func (d *Dispatcher) apiEnvironmentDelete(ctx context.Context, req Request) Response {
	storeRef := d.requireAPICatalog()
	if storeRef == nil {
		return errorResponse(req.ID, "api catalog store unavailable")
	}
	var params apiEnvironmentDeleteParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.EnvironmentID) == "" {
		return errorResponse(req.ID, "environmentId required")
	}
	if err := storeRef.DeleteEnvironment(ctx, params.EnvironmentID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"deleted": true})
}

// apiVariableList 处理 platform.api.variable.list。
func (d *Dispatcher) apiVariableList(ctx context.Context, req Request) Response {
	storeRef := d.requireAPICatalog()
	if storeRef == nil {
		return errorResponse(req.ID, "api catalog store unavailable")
	}
	var params apiVariableListParams
	if len(req.Params) > 0 && string(req.Params) != "null" {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	list, err := storeRef.ListVariables(ctx, params.WorkspaceID, params.VariableScope, params.ScopeRefID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	views := make([]apiVariableView, 0, len(list))
	for _, rec := range list {
		views = append(views, toAPIVariableView(rec))
	}
	return okResponse(req.ID, map[string]any{"variables": views})
}

// apiVariableUpsert 处理 platform.api.variable.upsert。
func (d *Dispatcher) apiVariableUpsert(ctx context.Context, req Request) Response {
	storeRef := d.requireAPICatalog()
	if storeRef == nil || d.ids == nil {
		return errorResponse(req.ID, "api catalog store unavailable")
	}
	var params apiVariableUpsertParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	variableID := strings.TrimSpace(params.VariableID)
	if variableID == "" {
		var err error
		variableID, err = d.ids.NextString()
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	rec, err := storeRef.UpsertVariable(ctx, paramsToVariableRecord(apiVariableUpsertParams{
		WorkspaceID:   params.WorkspaceID,
		VariableID:    variableID,
		VariableScope: params.VariableScope,
		ScopeRefID:    params.ScopeRefID,
		VariableName:  params.VariableName,
		VariableKind:  params.VariableKind,
		InitialValue:  params.InitialValue,
		CurrentValue:  params.CurrentValue,
		MetaJSON:      params.MetaJSON,
		SortOrder:     params.SortOrder,
	}))
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"variable": toAPIVariableView(rec)})
}

// apiVariableDelete 处理 platform.api.variable.delete。
func (d *Dispatcher) apiVariableDelete(ctx context.Context, req Request) Response {
	storeRef := d.requireAPICatalog()
	if storeRef == nil {
		return errorResponse(req.ID, "api catalog store unavailable")
	}
	var params apiVariableDeleteParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.VariableID) == "" {
		return errorResponse(req.ID, "variableId required")
	}
	if err := storeRef.DeleteVariable(ctx, params.VariableID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"deleted": true})
}

// apiVariableReplaceScope 处理 platform.api.variable.replaceScope。
func (d *Dispatcher) apiVariableReplaceScope(ctx context.Context, req Request) Response {
	storeRef := d.requireAPICatalog()
	if storeRef == nil || d.ids == nil {
		return errorResponse(req.ID, "api catalog store unavailable")
	}
	var params apiVariableReplaceScopeParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	rows := make([]store.APIVariableRecord, 0, len(params.Variables))
	for _, item := range params.Variables {
		rows = append(rows, paramsToVariableRecord(item))
	}
	list, err := storeRef.ReplaceScopeVariables(ctx, params.WorkspaceID, params.VariableScope, params.ScopeRefID, rows, d.ids.NextString)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	views := make([]apiVariableView, 0, len(list))
	for _, rec := range list {
		views = append(views, toAPIVariableView(rec))
	}
	return okResponse(req.ID, map[string]any{"variables": views})
}
