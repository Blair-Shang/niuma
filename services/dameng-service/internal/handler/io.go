package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/services/dameng-service/internal/dataio"
	"niuma/services/dameng-service/internal/session"
)

// resolveTaskConnect 从会话获取连接参数；若无 sessionId 则解析 platform 注入的 ConnectParams。
func (d *Dispatcher) resolveTaskConnect(raw json.RawMessage, sessionID string) (session.ConnectParams, string, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID != "" {
		sess, err := d.sessions.Get(sessionID)
		if err != nil {
			return session.ConnectParams{}, "", fmt.Errorf("dameng: session not found: %s", sessionID)
		}
		return sess.Params, sessionID, nil
	}
	var params session.ConnectParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return session.ConnectParams{}, "", fmt.Errorf("invalid params: %w", err)
	}
	if strings.TrimSpace(params.HostAddress) == "" {
		return session.ConnectParams{}, "", fmt.Errorf("sessionId or connection params required")
	}
	return params, "", nil
}

type ioExportCsvParams struct {
	SessionID  string            `json:"sessionId"`
	Schema     string            `json:"schema"`
	Database   string            `json:"database"`
	Table      string            `json:"table"`
	OutputPath string            `json:"outputPath"`
	CsvOptions dataio.CsvOptions `json:"csvOptions"`
}

func (d *Dispatcher) ioExportCsv(ctx context.Context, r Request) Response {
	var p ioExportCsvParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = p.Database
	}
	connect, sessionID, err := d.resolveTaskConnect(r.Params, p.SessionID)
	if err != nil {
		return fail(r.ID, err)
	}
	taskID, err := d.io.ExportCsv(ctx, connect, sessionID, schema, p.Table, p.OutputPath, p.CsvOptions)
	if err != nil {
		logOpWarn("io.exportCsv", err, "session", sessionID, "schema", schema, "table", p.Table)
		return fail(r.ID, err)
	}
	logOpInfo("io.exportCsv", "session", sessionID, "schema", schema, "table", p.Table, "task", taskID)
	return ok(r.ID, map[string]any{"taskId": taskID})
}

type ioImportCsvParams struct {
	SessionID  string            `json:"sessionId"`
	Schema     string            `json:"schema"`
	Database   string            `json:"database"`
	Table      string            `json:"table"`
	InputPath  string            `json:"inputPath"`
	CsvOptions dataio.CsvOptions `json:"csvOptions"`
}

func (d *Dispatcher) ioImportCsv(ctx context.Context, r Request) Response {
	var p ioImportCsvParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = p.Database
	}
	connect, sessionID, err := d.resolveTaskConnect(r.Params, p.SessionID)
	if err != nil {
		return fail(r.ID, err)
	}
	taskID, err := d.io.ImportCsv(ctx, connect, sessionID, schema, p.Table, p.InputPath, p.CsvOptions)
	if err != nil {
		logOpWarn("io.importCsv", err, "session", sessionID, "schema", schema, "table", p.Table)
		return fail(r.ID, err)
	}
	logOpInfo("io.importCsv", "session", sessionID, "schema", schema, "table", p.Table, "task", taskID)
	return ok(r.ID, map[string]any{"taskId": taskID})
}

type ioDumpSqlParams struct {
	SessionID string            `json:"sessionId"`
	Dump      dataio.DumpParams `json:"dump"`
}

func (d *Dispatcher) ioDumpSql(ctx context.Context, r Request) Response {
	var p ioDumpSqlParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	connect, sessionID, err := d.resolveTaskConnect(r.Params, p.SessionID)
	if err != nil {
		return fail(r.ID, err)
	}
	taskID, err := d.io.DumpSql(ctx, connect, sessionID, p.Dump)
	if err != nil {
		logOpWarn("io.dumpSql", err, "session", sessionID, "schema", p.Dump.Schema)
		return fail(r.ID, err)
	}
	logOpInfo("io.dumpSql", "session", sessionID, "schema", p.Dump.Schema, "task", taskID)
	return ok(r.ID, map[string]any{"taskId": taskID})
}

type ioExecSqlFileParams struct {
	SessionID   string                     `json:"sessionId"`
	Schema      string                     `json:"schema"`
	Database    string                     `json:"database"`
	InputPath   string                     `json:"inputPath"`
	ExecOptions dataio.ExecSqlFileOptions  `json:"execOptions"`
}

func (d *Dispatcher) ioExecSqlFile(ctx context.Context, r Request) Response {
	var p ioExecSqlFileParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	schema := strings.TrimSpace(p.Schema)
	if schema == "" {
		schema = p.Database
	}
	connect, sessionID, err := d.resolveTaskConnect(r.Params, p.SessionID)
	if err != nil {
		return fail(r.ID, err)
	}
	taskID, err := d.io.ExecSqlFile(ctx, connect, sessionID, schema, p.InputPath, p.ExecOptions)
	if err != nil {
		logOpWarn("io.execSqlFile", err, "session", sessionID, "schema", schema)
		return fail(r.ID, err)
	}
	logOpInfo("io.execSqlFile", "session", sessionID, "schema", schema, "task", taskID)
	return ok(r.ID, map[string]any{"taskId": taskID})
}

type ioCancelParams struct {
	SessionID string `json:"sessionId"`
	TaskID    string `json:"taskId"`
}

func (d *Dispatcher) ioCancel(_ context.Context, r Request) Response {
	var p ioCancelParams
	if e := params(r.Params, &p); e != nil {
		return fail(r.ID, e)
	}
	if p.TaskID == "" {
		return fail(r.ID, "taskId required")
	}
	if err := d.io.Cancel(p.TaskID); err != nil {
		logOpWarn("io.cancel", err, "session", p.SessionID, "task", p.TaskID)
		return fail(r.ID, err)
	}
	logOpInfo("io.cancel", "session", p.SessionID, "task", p.TaskID)
	return ok(r.ID, map[string]any{"canceled": true, "taskId": p.TaskID})
}
