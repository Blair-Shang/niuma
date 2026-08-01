// Package dataio 提供 SQLite CSV / SQL 旁路导入导出（异步任务 + 进度事件）。
package dataio

import (
	"context"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"

	"niuma/services/sqlite-service/internal/idgen"
	"niuma/services/sqlite-service/internal/session"
)

// Emitter 上报 IO 任务事件。
type Emitter func(payload map[string]any)

// TaskPhase 任务阶段。
type TaskPhase string

const (
	PhaseQueued   TaskPhase = "queued"
	PhaseRunning  TaskPhase = "running"
	PhaseDone     TaskPhase = "done"
	PhaseFailed   TaskPhase = "failed"
	PhaseCanceled TaskPhase = "canceled"
)

// CsvOptions 是 CSV 导入/导出选项。
type CsvOptions struct {
	Header     bool              `json:"header"`
	Delimiter  string            `json:"delimiter"`
	NullString string            `json:"nullString"`
	Truncate   bool              `json:"truncate"`
	Encoding   string            `json:"encoding"`
	ColumnMap  map[string]string `json:"columnMap"`
}

// DumpMode 控制 Dump SQL 内容范围。
type DumpMode string

const (
	DumpStructureAndData DumpMode = "structure_and_data"
	DumpStructureOnly    DumpMode = "structure_only"
	DumpDataOnly         DumpMode = "data_only"
)

// DumpParams 是 Dump SQL 参数（schema 对应 SQLite ATTACH 名，默认 main）。
type DumpParams struct {
	Schema             string   `json:"schema"`
	Database           string   `json:"database"` // 兼容：当作 schema
	Tables             []string `json:"tables"`
	Mode               DumpMode `json:"mode"`
	OutputPath         string   `json:"outputPath"`
	DropIfExists       bool     `json:"dropIfExists"`
	TruncateBeforeData bool     `json:"truncateBeforeData"`
	IncludeTables      bool     `json:"includeTables"`
	IncludeViews       bool     `json:"includeViews"`
	IncludeTriggers    bool     `json:"includeTriggers"`
	IncludeIndexes     bool     `json:"includeIndexes"`
}

// ExecSqlFileOptions 控制执行 SQL 文件的行为。
type ExecSqlFileOptions struct {
	ContinueOnError bool `json:"continueOnError"`
}

func normalizeDumpParams(p *DumpParams) {
	if strings.TrimSpace(p.Schema) == "" {
		p.Schema = schemaOrMain(p.Database)
	}
	if p.Mode == "" {
		p.Mode = DumpStructureAndData
	}
	if !p.IncludeTables && !p.IncludeViews && !p.IncludeTriggers && !p.IncludeIndexes {
		p.IncludeTables = true
		p.IncludeViews = true
		p.IncludeTriggers = true
		p.IncludeIndexes = true
	}
}

// Manager 管理异步 IO 任务。
type Manager struct {
	mu    sync.Mutex
	tasks map[string]*task
	ids   idgen.Generator
	emit  Emitter
}

type task struct {
	taskID    string
	sessionID string
	cancel    context.CancelFunc
}

// NewManager 创建 IO 任务管理器。
func NewManager(ids idgen.Generator, emit Emitter) *Manager {
	return &Manager{
		tasks: make(map[string]*task),
		ids:   ids,
		emit:  emit,
	}
}

// ExportCsv 异步导出表为 CSV。
func (m *Manager) ExportCsv(
	parent context.Context,
	connect session.ConnectParams,
	sessionID, schema, table, outputPath string,
	opts CsvOptions,
) (string, error) {
	schema = schemaOrMain(schema)
	if err := requireRelation(schema, table); err != nil {
		return "", err
	}
	if err := requirePath(outputPath); err != nil {
		return "", err
	}
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		db, stop, err := openDB(ctx, connect)
		if err != nil {
			return "", err
		}
		defer stop()
		return outputPath, exportCsv(ctx, db, taskID, m, schema, table, outputPath, opts)
	})
}

// ImportCsv 异步从 CSV 导入表。
func (m *Manager) ImportCsv(
	parent context.Context,
	connect session.ConnectParams,
	sessionID, schema, table, inputPath string,
	opts CsvOptions,
) (string, error) {
	schema = schemaOrMain(schema)
	if err := requireRelation(schema, table); err != nil {
		return "", err
	}
	if err := requirePath(inputPath); err != nil {
		return "", err
	}
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		db, stop, err := openDB(ctx, connect)
		if err != nil {
			return "", err
		}
		defer stop()
		return inputPath, importCsv(ctx, db, taskID, m, schema, table, inputPath, opts)
	})
}

// DumpSql 异步转储 schema 结构/数据。
func (m *Manager) DumpSql(
	parent context.Context,
	connect session.ConnectParams,
	sessionID string,
	params DumpParams,
) (string, error) {
	normalizeDumpParams(&params)
	if strings.TrimSpace(params.Schema) == "" {
		return "", errDatabaseRequired
	}
	if err := requirePath(params.OutputPath); err != nil {
		return "", err
	}
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		db, stop, err := openDB(ctx, connect)
		if err != nil {
			return "", err
		}
		defer stop()
		return params.OutputPath, dumpSql(ctx, db, taskID, m, params)
	})
}

// ExecSqlFile 异步执行 SQL 文件。
func (m *Manager) ExecSqlFile(
	parent context.Context,
	connect session.ConnectParams,
	sessionID, schema, inputPath string,
	opts ExecSqlFileOptions,
) (string, error) {
	_ = schemaOrMain(schema) // 预留：未来可 USE/ATTACH 上下文
	if err := requirePath(inputPath); err != nil {
		return "", err
	}
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		db, stop, err := openDB(ctx, connect)
		if err != nil {
			return "", err
		}
		defer stop()
		return inputPath, execSqlFile(ctx, db, taskID, m, inputPath, opts)
	})
}

// Cancel 取消指定任务。
func (m *Manager) Cancel(taskID string) error {
	m.mu.Lock()
	t, ok := m.tasks[taskID]
	m.mu.Unlock()
	if !ok {
		return errTaskNotFound
	}
	if t.cancel != nil {
		t.cancel()
	}
	return nil
}

// CancelBySession 取消会话下全部 IO 任务。
func (m *Manager) CancelBySession(sessionID string) {
	m.mu.Lock()
	var ids []string
	for id, t := range m.tasks {
		if t.sessionID == sessionID {
			ids = append(ids, id)
		}
	}
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.Cancel(id)
	}
}

type runnerFunc func(ctx context.Context, taskID string) (outputPath string, err error)

func (m *Manager) start(parent context.Context, sessionID string, run runnerFunc) (string, error) {
	taskID, err := m.ids.NextString()
	if err != nil {
		return "", err
	}
	runCtx, cancel := context.WithCancel(parent)
	t := &task{taskID: taskID, sessionID: sessionID, cancel: cancel}
	m.mu.Lock()
	m.tasks[taskID] = t
	m.mu.Unlock()

	m.emitProgress(taskID, PhaseQueued, 0, 0, "queued")
	go func() {
		defer func() {
			m.mu.Lock()
			delete(m.tasks, taskID)
			m.mu.Unlock()
			cancel()
		}()
		m.emitProgress(taskID, PhaseRunning, 0, 0, "running")
		out, err := run(runCtx, taskID)
		select {
		case <-runCtx.Done():
			m.emitDone(taskID, false, "canceled", out)
			return
		default:
		}
		if err != nil {
			msg := err.Error()
			if strings.Contains(msg, "context canceled") {
				msg = "canceled"
			}
			slog.Error("sqlite.io.task.done", "task", taskID, "ok", false, "message", msg)
			m.emitDone(taskID, false, msg, out)
			return
		}
		slog.Info("sqlite.io.task.done", "task", taskID, "ok", true, "output", out)
		m.emitDone(taskID, true, "completed", out)
	}()
	return taskID, nil
}

func (m *Manager) emitProgress(taskID string, phase TaskPhase, bytes, rows int64, message string) {
	m.emitEvent(map[string]any{
		"type":    "sqlite.io.progress",
		"taskId":  taskID,
		"phase":   string(phase),
		"bytes":   bytes,
		"rows":    rows,
		"message": message,
	})
}

func (m *Manager) emitDone(taskID string, ok bool, message, outputPath string) {
	payload := map[string]any{
		"type":    "sqlite.io.done",
		"taskId":  taskID,
		"ok":      ok,
		"message": message,
	}
	if outputPath != "" {
		payload["outputPath"] = filepath.Clean(outputPath)
	}
	m.emitEvent(payload)
}

func (m *Manager) emitEvent(payload map[string]any) {
	if m.emit != nil {
		m.emit(payload)
	}
}
