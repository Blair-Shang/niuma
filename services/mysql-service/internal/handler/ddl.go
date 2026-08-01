package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/services/mysql-service/internal/ddl"
)

func (d *Dispatcher) ddlDesignPreview(_ context.Context, req Request) Response {
	var params ddl.DesignPreviewParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Database == "" || params.Name == "" {
		return errorResponse(req.ID, "database and name required")
	}

	result, err := ddl.PreviewDesign(params)
	if err != nil {
		logOpWarn(MethodDDLDesignPreview, err, "database", params.Database, "table", params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLDesignPreview, "database", params.Database, "table", params.Name, "statements", len(result.SQL))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) ddlDesignApply(ctx context.Context, req Request) Response {
	var params ddl.DesignApplyParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Database == "" || params.Name == "" {
		return errorResponse(req.ID, "database and name required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := ddl.ApplyDesign(ctx, db, params)
	if err != nil {
		logOpWarn(MethodDDLDesignApply, err, "database", params.Database, "table", params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLDesignApply, "database", params.Database, "table", params.Name, "statements", len(result.SQL), "durationMs", result.DurationMS)
	return okResponse(req.ID, result)
}

func (d *Dispatcher) ddlCreateTablePreview(_ context.Context, req Request) Response {
	var params ddl.CreateTableParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Database == "" || params.Name == "" {
		return errorResponse(req.ID, "database and name required")
	}

	result, err := ddl.PreviewCreateTable(params)
	if err != nil {
		logOpWarn(MethodDDLCreateTablePreview, err, "database", params.Database, "table", params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLCreateTablePreview, "database", params.Database, "table", params.Name, "statements", len(result.SQL))
	return okResponse(req.ID, result)
}

func (d *Dispatcher) ddlCreateTable(ctx context.Context, req Request) Response {
	var params ddl.CreateTableParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.Database == "" || params.Name == "" {
		return errorResponse(req.ID, "database and name required")
	}

	db, _, release, err := d.resolveDBForDatabase(ctx, req.Params, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	defer release()

	result, err := ddl.ApplyCreateTable(ctx, db, params)
	if err != nil {
		logOpWarn(MethodDDLCreateTable, err, "database", params.Database, "table", params.Name)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodDDLCreateTable, "database", params.Database, "table", params.Name, "durationMs", result.DurationMS)
	return okResponse(req.ID, result)
}
