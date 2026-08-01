package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/sqlite-service/internal/dataio"
	"niuma/services/sqlite-service/internal/session"
)

// resolveTaskConnect 从会话或 platform 注入的 ConnectParams 解析旁路连接。
func (d *Dispatcher) resolveTaskConnect(raw json.RawMessage, sessionID string) (session.ConnectParams, string, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID != "" {
		sess, err := d.sessions.Get(sessionID)
		if err != nil {
			return session.ConnectParams{}, "", fmt.Errorf("sqlite: session not found: %s", sessionID)
		}
		return sess.Params, sessionID, nil
	}
	var params session.ConnectParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return session.ConnectParams{}, "", fmt.Errorf(errInvalidParamsFmt, err)
	}
	if strings.TrimSpace(params.ResolvedFilePath()) == "" {
		return session.ConnectParams{}, "", fmt.Errorf("sessionId or connection params required")
	}
	return params, "", nil
}

type ioExportCsvParams struct {
	SessionID  string            `json:"sessionId"`
	ProfileID  string            `json:"profileId"`
	Schema     string            `json:"schema"`
	Database   string            `json:"database"` // 兼容：当作 schema
	Table      string            `json:"table"`
	OutputPath string            `json:"outputPath"`
	// csvOptions 勿用 options：platform 凭据注入会用连接 options 覆盖同名字段。
	CsvOptions dataio.CsvOptions `json:"csvOptions"`
}

func (d *Dispatcher) ioExportCsv(ctx context.Context, req Request) Response {
	var params ioExportCsvParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		schema = params.Database
	}

	connect, sessionID, err := d.resolveTaskConnect(req.Params, params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	taskID, err := d.io.ExportCsv(ctx, connect, sessionID, schema, params.Table, params.OutputPath, params.CsvOptions)
	if err != nil {
		logOpWarn(MethodIOExportCsv, err, "session", sessionID, "schema", schema, "table", params.Table)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIOExportCsv, "session", sessionID, "schema", schema, "table", params.Table, "task", taskID)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

type ioImportCsvParams struct {
	SessionID  string            `json:"sessionId"`
	ProfileID  string            `json:"profileId"`
	Schema     string            `json:"schema"`
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
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		schema = params.Database
	}

	connect, sessionID, err := d.resolveTaskConnect(req.Params, params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	taskID, err := d.io.ImportCsv(ctx, connect, sessionID, schema, params.Table, params.InputPath, params.CsvOptions)
	if err != nil {
		logOpWarn(MethodIOImportCsv, err, "session", sessionID, "schema", schema, "table", params.Table)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIOImportCsv, "session", sessionID, "schema", schema, "table", params.Table, "task", taskID)
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

	connect, sessionID, err := d.resolveTaskConnect(req.Params, params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	taskID, err := d.io.DumpSql(ctx, connect, sessionID, params.Dump)
	if err != nil {
		logOpWarn(MethodIODumpSql, err, "session", sessionID, "schema", params.Dump.Schema)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIODumpSql, "session", sessionID, "schema", params.Dump.Schema, "task", taskID)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

type ioExecSqlFileParams struct {
	SessionID string `json:"sessionId"`
	ProfileID string `json:"profileId"`
	Schema    string `json:"schema"`
	Database  string `json:"database"`
	InputPath string `json:"inputPath"`
	// execOptions 勿用 options：platform 凭据注入会用连接 options 覆盖同名字段。
	ExecOptions dataio.ExecSqlFileOptions `json:"execOptions"`
}

func (d *Dispatcher) ioExecSqlFile(ctx context.Context, req Request) Response {
	var params ioExecSqlFileParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		schema = params.Database
	}

	connect, sessionID, err := d.resolveTaskConnect(req.Params, params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	taskID, err := d.io.ExecSqlFile(ctx, connect, sessionID, schema, params.InputPath, params.ExecOptions)
	if err != nil {
		logOpWarn(MethodIOExecSqlFile, err, "session", sessionID, "schema", schema)
		return errorResponse(req.ID, err.Error())
	}
	logOpInfo(MethodIOExecSqlFile, "session", sessionID, "schema", schema, "task", taskID)
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
