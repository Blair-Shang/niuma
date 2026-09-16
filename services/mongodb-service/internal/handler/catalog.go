package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mongodb-service/internal/session"
)

type createDatabaseParams struct {
	SessionID  string `json:"sessionId"`
	Database   string `json:"database"`
	Collection string `json:"collection"`
}

type renameCollectionParams struct {
	SessionID string `json:"sessionId"`
	Database  string `json:"database"`
	From      string `json:"from"`
	To        string `json:"to"`
}

type renameDatabaseParams struct {
	SessionID string `json:"sessionId"`
	From      string `json:"from"`
	To        string `json:"to"`
}

func (d *Dispatcher) catalogCreateDatabase(ctx context.Context, req Request) Response {
	var params createDatabaseParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	client, release, err := d.resolveClient(ctx, req.Params)
	if err != nil {
		logOpError(MethodCatalogCreateDatabase, err, scopeAttrs(params.SessionID, params.Database, params.Collection)...)
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	if err := session.CreateDatabase(ctx, client, session.CreateDatabaseParams{
		Database:   params.Database,
		Collection: params.Collection,
	}); err != nil {
		logOpWarn(MethodCatalogCreateDatabase, err, scopeAttrs(params.SessionID, params.Database, params.Collection)...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodCatalogCreateDatabase, scopeAttrs(params.SessionID, params.Database, params.Collection)...)
	return okResponse(req.ID, map[string]any{"created": true})
}

func (d *Dispatcher) catalogRenameCollection(ctx context.Context, req Request) Response {
	var params renameCollectionParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	client, release, err := d.resolveClient(ctx, req.Params)
	if err != nil {
		logOpError(MethodCatalogRenameCollection, err, scopeAttrs(params.SessionID, params.Database, params.From)...)
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	if err := session.RenameCollection(ctx, client, session.RenameCollectionParams{
		Database: params.Database,
		From:     params.From,
		To:       params.To,
	}); err != nil {
		logOpWarn(MethodCatalogRenameCollection, err, append(scopeAttrs(params.SessionID, params.Database, params.From), "to", params.To)...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodCatalogRenameCollection, append(scopeAttrs(params.SessionID, params.Database, params.From), "to", params.To)...)
	return okResponse(req.ID, map[string]any{"renamed": true})
}

func (d *Dispatcher) catalogRenameDatabase(ctx context.Context, req Request) Response {
	var params renameDatabaseParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	client, release, err := d.resolveClient(ctx, req.Params)
	if err != nil {
		logOpError(MethodCatalogRenameDatabase, err, scopeAttrs(params.SessionID, params.From, "")...)
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	if err := session.RenameDatabase(ctx, client, session.RenameDatabaseParams{
		From: params.From,
		To:   params.To,
	}); err != nil {
		logOpWarn(MethodCatalogRenameDatabase, err, append(scopeAttrs(params.SessionID, params.From, ""), "to", params.To)...)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodCatalogRenameDatabase, append(scopeAttrs(params.SessionID, params.From, ""), "to", params.To)...)
	return okResponse(req.ID, map[string]any{"renamed": true})
}
