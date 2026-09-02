package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/platform/internal/store"
)

const (
	// MethodAPIHistoryList 列出 API 发送历史。
	MethodAPIHistoryList = "platform.api.history.list"
	// MethodAPIHistoryAppend 追加一条发送快照。
	MethodAPIHistoryAppend = "platform.api.history.append"
	// MethodAPIHistoryDelete 删除一条历史。
	MethodAPIHistoryDelete = "platform.api.history.delete"
	// MethodAPIHistoryClear 清空工作区历史。
	MethodAPIHistoryClear = "platform.api.history.clear"
)

type apiHistoryListParams struct {
	WorkspaceID string `json:"workspaceId"`
	RequestID   string `json:"requestId"`
	Limit       int    `json:"limit"`
}

type apiHistoryAppendParams struct {
	WorkspaceID     string          `json:"workspaceId"`
	RequestID       string          `json:"requestId"`
	RequestName     string          `json:"requestName"`
	HTTPMethod      string          `json:"httpMethod"`
	RequestURL      string          `json:"requestUrl"`
	EnvironmentID   string          `json:"environmentId"`
	EnvironmentName string          `json:"environmentName"`
	RequestJSON     json.RawMessage `json:"requestJson"`
	ExchangeJSON    json.RawMessage `json:"exchangeJson"`
	DurationMS      int64           `json:"durationMs"`
	HTTPStatus      *int64          `json:"httpStatus"`
}

type apiHistoryDeleteParams struct {
	HistoryID string `json:"historyId"`
}

type apiHistoryClearParams struct {
	WorkspaceID string `json:"workspaceId"`
}

type apiHistoryView struct {
	HistoryID       string          `json:"historyId"`
	WorkspaceID     string          `json:"workspaceId"`
	RequestID       string          `json:"requestId"`
	RequestName     string          `json:"requestName"`
	HTTPMethod      string          `json:"httpMethod"`
	RequestURL      string          `json:"requestUrl"`
	EnvironmentID   string          `json:"environmentId"`
	EnvironmentName string          `json:"environmentName"`
	RequestJSON     json.RawMessage `json:"requestJson"`
	ExchangeJSON    json.RawMessage `json:"exchangeJson"`
	DurationMS      int64           `json:"durationMs"`
	HTTPStatus      *int64          `json:"httpStatus"`
	CreatedAt       string          `json:"createdAt"`
}

func toAPIHistoryView(rec store.APIHistoryRecord) apiHistoryView {
	view := apiHistoryView{
		HistoryID:       rec.HistoryID,
		WorkspaceID:     rec.WorkspaceID,
		RequestID:       rec.RequestID,
		RequestName:     rec.RequestName,
		HTTPMethod:      rec.HTTPMethod,
		RequestURL:      rec.RequestURL,
		EnvironmentID:   rec.EnvironmentID,
		EnvironmentName: rec.EnvironmentName,
		RequestJSON:     json.RawMessage(orJSONObject(rec.RequestJSON)),
		ExchangeJSON:    json.RawMessage(orJSONObject(rec.ExchangeJSON)),
		DurationMS:      rec.DurationMS,
		CreatedAt:       rec.CreatedAt,
	}
	if rec.HTTPStatus.Valid {
		status := rec.HTTPStatus.Int64
		view.HTTPStatus = &status
	}
	return view
}

func orJSONObject(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return "{}"
	}
	return raw
}

func (d *Dispatcher) requireAPIHistory() *store.APIHistoryStore {
	return d.apiHistory
}

// apiHistoryList 处理 platform.api.history.list。
func (d *Dispatcher) apiHistoryList(ctx context.Context, req Request) Response {
	storeRef := d.requireAPIHistory()
	if storeRef == nil {
		return errorResponse(req.ID, "api history store unavailable")
	}
	var params apiHistoryListParams
	if len(req.Params) > 0 && string(req.Params) != "null" {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	list, err := storeRef.List(ctx, params.WorkspaceID, params.RequestID, params.Limit)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	views := make([]apiHistoryView, 0, len(list))
	for _, rec := range list {
		views = append(views, toAPIHistoryView(rec))
	}
	return okResponse(req.ID, map[string]any{"entries": views})
}

// apiHistoryAppend 处理 platform.api.history.append。
func (d *Dispatcher) apiHistoryAppend(ctx context.Context, req Request) Response {
	storeRef := d.requireAPIHistory()
	if storeRef == nil || d.ids == nil {
		return errorResponse(req.ID, "api history store unavailable")
	}
	var params apiHistoryAppendParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	method := strings.TrimSpace(params.HTTPMethod)
	if method == "" {
		return errorResponse(req.ID, "httpMethod required")
	}
	historyID, err := d.ids.NextString()
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	rec := store.APIHistoryRecord{
		HistoryID:       historyID,
		WorkspaceID:     params.WorkspaceID,
		RequestID:       strings.TrimSpace(params.RequestID),
		RequestName:     params.RequestName,
		HTTPMethod:      method,
		RequestURL:      params.RequestURL,
		EnvironmentID:   strings.TrimSpace(params.EnvironmentID),
		EnvironmentName: params.EnvironmentName,
		RequestJSON:     string(params.RequestJSON),
		ExchangeJSON:    string(params.ExchangeJSON),
		DurationMS:      params.DurationMS,
	}
	if params.HTTPStatus != nil {
		rec.HTTPStatus = sql.NullInt64{Int64: *params.HTTPStatus, Valid: true}
	}
	if err := storeRef.Append(ctx, rec); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	list, err := storeRef.List(ctx, rec.WorkspaceID, "", 1)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if len(list) == 0 {
		return okResponse(req.ID, map[string]any{"entry": toAPIHistoryView(rec)})
	}
	return okResponse(req.ID, map[string]any{"entry": toAPIHistoryView(list[0])})
}

// apiHistoryDelete 处理 platform.api.history.delete。
func (d *Dispatcher) apiHistoryDelete(ctx context.Context, req Request) Response {
	storeRef := d.requireAPIHistory()
	if storeRef == nil {
		return errorResponse(req.ID, "api history store unavailable")
	}
	var params apiHistoryDeleteParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if strings.TrimSpace(params.HistoryID) == "" {
		return errorResponse(req.ID, "historyId required")
	}
	if err := storeRef.Delete(ctx, params.HistoryID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"deleted": true})
}

// apiHistoryClear 处理 platform.api.history.clear。
func (d *Dispatcher) apiHistoryClear(ctx context.Context, req Request) Response {
	storeRef := d.requireAPIHistory()
	if storeRef == nil {
		return errorResponse(req.ID, "api history store unavailable")
	}
	var params apiHistoryClearParams
	if len(req.Params) > 0 && string(req.Params) != "null" {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	if err := storeRef.Clear(ctx, params.WorkspaceID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"cleared": true})
}
