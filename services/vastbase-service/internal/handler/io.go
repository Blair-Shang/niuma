package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/vastbase-service/internal/dataio"
	"niuma/services/vastbase-service/internal/session"
)

type ioCsvParams struct {
	SessionID  string            `json:"sessionId"`
	ProfileID  string            `json:"profileId"`
	Database   string            `json:"database"`
	Schema     string            `json:"schema"`
	Table      string            `json:"table"`
	OutputPath string            `json:"outputPath"`
	InputPath  string            `json:"inputPath"`
	Options    dataio.CsvOptions `json:"options"`
}

type ioDumpParams struct {
	SessionID          string          `json:"sessionId"`
	Database           string          `json:"database"`
	Schema             string          `json:"schema"`
	Tables             []string        `json:"tables"`
	Mode               dataio.DumpMode `json:"mode"`
	OutputPath         string          `json:"outputPath"`
	IncludeTables      bool            `json:"includeTables"`
	IncludeViews       bool            `json:"includeViews"`
	IncludeMatViews    bool            `json:"includeMatViews"`
	DropIfExists       bool            `json:"dropIfExists"`
	TruncateBeforeData bool            `json:"truncateBeforeData"`
	CreateSchema       *bool           `json:"createSchema"`
	ExcludeSystem      *bool           `json:"excludeSystem"`
}

type ioExecFileParams struct {
	SessionID       string `json:"sessionId"`
	Database        string `json:"database"`
	InputPath       string `json:"inputPath"`
	ContinueOnError bool   `json:"continueOnError"`
}

type ioTaskIDParams struct {
	TaskID string `json:"taskId"`
}

func (d *Dispatcher) ioExportCsv(ctx context.Context, req Request) Response {
	var params ioCsvParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	connect, sessionID, err := d.resolveTaskConnect(ctx, req.Params, params.SessionID, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	taskID, err := d.io.ExportCsv(ctx, connect, sessionID, params.Database, params.Schema, params.Table, params.OutputPath, params.Options)
	if err != nil {
		logOpError(MethodIOExportCsv, err, "database", params.Database, "schema", params.Schema, "table", params.Table)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIOExportCsv, "task", taskID, "database", params.Database, "table", params.Table)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) ioImportCsv(ctx context.Context, req Request) Response {
	var params ioCsvParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	connect, sessionID, err := d.resolveTaskConnect(ctx, req.Params, params.SessionID, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	taskID, err := d.io.ImportCsv(ctx, connect, sessionID, params.Database, params.Schema, params.Table, params.InputPath, params.Options)
	if err != nil {
		logOpError(MethodIOImportCsv, err, "database", params.Database, "schema", params.Schema, "table", params.Table)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIOImportCsv, "task", taskID, "database", params.Database, "table", params.Table)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) ioDumpSql(ctx context.Context, req Request) Response {
	var params ioDumpParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	connect, sessionID, err := d.resolveTaskConnect(ctx, req.Params, params.SessionID, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	taskID, err := d.io.DumpSql(ctx, connect, sessionID, dataio.DumpParams{
		Database:           params.Database,
		Schema:             params.Schema,
		Tables:             params.Tables,
		Mode:               params.Mode,
		OutputPath:         params.OutputPath,
		IncludeTables:      params.IncludeTables,
		IncludeViews:       params.IncludeViews,
		IncludeMatViews:    params.IncludeMatViews,
		DropIfExists:       params.DropIfExists,
		TruncateBeforeData: params.TruncateBeforeData,
		CreateSchema:       params.CreateSchema,
		ExcludeSystem:      params.ExcludeSystem,
	})
	if err != nil {
		logOpError(MethodIODumpSql, err, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIODumpSql, "task", taskID, "database", params.Database)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) ioExecSqlFile(ctx context.Context, req Request) Response {
	var params ioExecFileParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	connect, sessionID, err := d.resolveTaskConnect(ctx, req.Params, params.SessionID, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	taskID, err := d.io.ExecSqlFile(ctx, connect, sessionID, params.Database, params.InputPath, dataio.ExecSqlFileOptions{
		ContinueOnError: params.ContinueOnError,
	})
	if err != nil {
		logOpError(MethodIOExecSqlFile, err, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIOExecSqlFile, "task", taskID, "database", params.Database)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) ioCancel(_ context.Context, req Request) Response {
	var params ioTaskIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if err := d.io.Cancel(params.TaskID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"canceled": true})
}

// resolveTaskConnect 解析异步任务建连参数（会话快照或 platform 注入的 ConnectParams）。
func (d *Dispatcher) resolveTaskConnect(
	ctx context.Context,
	raw json.RawMessage,
	sessionID, database string,
) (session.ConnectParams, string, error) {
	_ = ctx
	sessionID = strings.TrimSpace(sessionID)
	if sessionID != "" {
		s, err := d.sessions.Get(sessionID)
		if err != nil {
			return session.ConnectParams{}, "", err
		}
		p := s.Params
		if db := strings.TrimSpace(database); db != "" {
			p.Options.Database = db
		}
		return p, sessionID, nil
	}
	var params session.ConnectParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return session.ConnectParams{}, "", fmt.Errorf(errInvalidParamsFmt, err)
	}
	if strings.TrimSpace(params.HostAddress) == "" {
		return session.ConnectParams{}, "", fmt.Errorf("sessionId or connection params required")
	}
	if db := strings.TrimSpace(database); db != "" {
		params.Options.Database = db
	}
	return params, "", nil
}
