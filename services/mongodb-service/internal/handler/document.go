package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"niuma/services/mongodb-service/internal/session"
)
type documentScopeParams struct {
	SessionID  string `json:"sessionId"`
	Database   string `json:"database"`
	Collection string `json:"collection"`
}

type documentFindParams struct {
	documentScopeParams
	Filter     json.RawMessage `json:"filter,omitempty"`
	Sort       json.RawMessage `json:"sort,omitempty"`
	Projection json.RawMessage `json:"projection,omitempty"`
	Skip       int64           `json:"skip,omitempty"`
	Limit      int64           `json:"limit,omitempty"`
}

type documentIDParams struct {
	documentScopeParams
	ID json.RawMessage `json:"id"`
}

type documentInsertParams struct {
	documentScopeParams
	Document json.RawMessage `json:"document"`
}

type documentUpdateParams struct {
	documentIDParams
	Document json.RawMessage `json:"document"`
}

func (d *Dispatcher) documentFind(ctx context.Context, req Request) Response {
	var params documentFindParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	result, err := session.FindDocuments(ctx, s.Client, session.FindParams{
		Database:   params.Database,
		Collection: params.Collection,
		Filter:     params.Filter,
		Sort:       params.Sort,
		Projection: params.Projection,
		Skip:       params.Skip,
		Limit:      params.Limit,
	})
	if err != nil {
		slog.Warn(MethodDocumentFind, "session", params.SessionID, "database", params.Database, "collection", params.Collection, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, result)
}

func (d *Dispatcher) documentGet(ctx context.Context, req Request) Response {
	var params documentIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	doc, err := session.GetDocument(ctx, s.Client, params.Database, params.Collection, params.ID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"document": doc})
}

func (d *Dispatcher) documentInsert(ctx context.Context, req Request) Response {
	var params documentInsertParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	insertedID, err := session.InsertDocument(ctx, s.Client, params.Database, params.Collection, params.Document)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"insertedId": insertedID})
}

func (d *Dispatcher) documentUpdate(ctx context.Context, req Request) Response {
	var params documentUpdateParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	matched, modified, err := session.UpdateDocument(ctx, s.Client, params.Database, params.Collection, params.ID, params.Document)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"matched": matched, "modified": modified})
}

func (d *Dispatcher) documentDelete(ctx context.Context, req Request) Response {
	var params documentIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	s, resp, ok := d.requireSession(req.ID, params.SessionID)
	if !ok {
		return resp
	}
	deleted, err := session.DeleteDocument(ctx, s.Client, params.Database, params.Collection, params.ID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"deleted": deleted})
}

func (d *Dispatcher) requireSession(reqID, sessionID string) (*session.Session, Response, bool) {
	if sessionID == "" {
		return nil, errorResponse(reqID, errSessionIDRequired), false
	}
	s, err := d.sessions.Get(sessionID)
	if err != nil {
		return nil, errorResponse(reqID, err.Error()), false
	}
	return s, Response{}, true
}
