package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/clickhouse-service/internal/dataio"
	"niuma/services/clickhouse-service/internal/session"
)

// resolveTaskConnect 从会话获取连接参数；若无 sessionId 则解析 platform 注入的 ConnectParams。
func (d *Dispatcher) resolveTaskConnect(raw json.RawMessage, sessionID, database string) (session.ConnectParams, string, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID != "" {
		sess, err := d.sessions.Get(sessionID)
		if err != nil {
			return session.ConnectParams{}, "", fmt.Errorf("clickhouse: session not found: %s", sessionID)
		}
		p := sess.Params
		if database != "" {
			p.Options.Database = database
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
	if database != "" {
		params.Options.Database = database
	}
	return params, "", nil
}

type ioExportCsvParams struct {
	SessionID  string            `json:"sessionId"`
	ProfileID  string            `json:"profileId"`
	Database   string            `json:"database"`
	Table      string            `json:"table"`
	OutputPath string            `json:"outputPath"`
	CsvOptions dataio.CsvOptions `json:"csvOptions"`
}

func (d *Dispatcher) ioExportCsv(ctx context.Context, req Request) Response {
	var params ioExportCsvParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}

	connect, sessionID, err := d.resolveTaskConnect(req.Params, params.SessionID, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	taskID, err := d.io.ExportCsv(ctx, connect, sessionID, params.Database, params.Table, params.OutputPath, params.CsvOptions)
	if err != nil {
		logOpWarn(MethodIOExportCsv, err, "session", sessionID, "database", params.Database, "table", params.Table)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIOExportCsv, "session", sessionID, "database", params.Database, "table", params.Table, "task", taskID)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

type ioImportCsvParams struct {
	SessionID  string            `json:"sessionId"`
	ProfileID  string            `json:"profileId"`
	Database   string            `json:"database"`
	Table      string            `json:"table"`
	InputPath  string            `json:"inputPath"`
	CsvOptions dataio.CsvOptions `json:"csvOptions"`
}

func (d *Dispatcher) ioImportCsv(ctx context.Context, req Request) Response {
	var params ioImportCsvParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}

	connect, sessionID, err := d.resolveTaskConnect(req.Params, params.SessionID, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	taskID, err := d.io.ImportCsv(ctx, connect, sessionID, params.Database, params.Table, params.InputPath, params.CsvOptions)
	if err != nil {
		logOpWarn(MethodIOImportCsv, err, "session", sessionID, "database", params.Database, "table", params.Table)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIOImportCsv, "session", sessionID, "database", params.Database, "table", params.Table, "task", taskID)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

type ioDumpSqlParams struct {
	SessionID string            `json:"sessionId"`
	ProfileID string            `json:"profileId"`
	Dump      dataio.DumpParams `json:"dump"`
}

func (d *Dispatcher) ioDumpSql(ctx context.Context, req Request) Response {
	var params ioDumpSqlParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}

	connect, sessionID, err := d.resolveTaskConnect(req.Params, params.SessionID, params.Dump.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	taskID, err := d.io.DumpSql(ctx, connect, sessionID, params.Dump)
	if err != nil {
		logOpWarn(MethodIODumpSql, err, "session", sessionID, "database", params.Dump.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIODumpSql, "session", sessionID, "database", params.Dump.Database, "task", taskID)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

type ioExecSqlFileParams struct {
	SessionID   string                     `json:"sessionId"`
	ProfileID   string                     `json:"profileId"`
	Database    string                     `json:"database"`
	InputPath   string                     `json:"inputPath"`
	ExecOptions dataio.ExecSqlFileOptions `json:"execOptions"`
}

func (d *Dispatcher) ioExecSqlFile(ctx context.Context, req Request) Response {
	var params ioExecSqlFileParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}

	connect, sessionID, err := d.resolveTaskConnect(req.Params, params.SessionID, params.Database)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	taskID, err := d.io.ExecSqlFile(ctx, connect, sessionID, params.Database, params.InputPath, params.ExecOptions)
	if err != nil {
		logOpWarn(MethodIOExecSqlFile, err, "session", sessionID, "database", params.Database)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIOExecSqlFile, "session", sessionID, "database", params.Database, "task", taskID)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

type ioCancelParams struct {
	SessionID string `json:"sessionId"`
	TaskID    string `json:"taskId"`
}

func (d *Dispatcher) ioCancel(_ context.Context, req Request) Response {
	var params ioCancelParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.TaskID == "" {
		return errorResponse(req.ID, "taskId required")
	}

	if err := d.io.Cancel(params.TaskID); err != nil {
		logOpWarn(MethodIOCancel, err, "session", params.SessionID, "task", params.TaskID)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIOCancel, "session", params.SessionID, "task", params.TaskID)
	return okResponse(req.ID, map[string]any{"canceled": true, "taskId": params.TaskID})
}
