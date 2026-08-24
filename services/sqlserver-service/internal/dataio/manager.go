package dataio

import (
	"context"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"

	"niuma/services/sqlserver-service/internal/idgen"
	"niuma/services/sqlserver-service/internal/session"
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

// DumpParams 是 Dump SQL 参数（database + 可选 schema）。
// Schema 为空表示库级转储：扫描全部用户 schema（默认排除系统 schema）。
type DumpParams struct {
	Database           string   `json:"database"`
	Schema             string   `json:"schema"`
	Tables             []string `json:"tables"`
	Mode               DumpMode `json:"mode"`
	OutputPath         string   `json:"outputPath"`
	DropIfExists       bool     `json:"dropIfExists"`
	TruncateBeforeData bool     `json:"truncateBeforeData"`
	IncludeTables      bool     `json:"includeTables"`
	IncludeViews       bool     `json:"includeViews"`
	IncludeProcedures  bool     `json:"includeProcedures"`
	IncludeFunctions   bool     `json:"includeFunctions"`
	IncludeSynonyms    bool     `json:"includeSynonyms"`
	IncludeSequences   bool     `json:"includeSequences"`

	// CreateSchema / ExcludeSystem 默认 true（nil 时）。
	CreateSchema  *bool `json:"createSchema"`
	ExcludeSystem *bool `json:"excludeSystem"`
}

// ExecSqlFileOptions 控制执行 SQL 文件的行为。
type ExecSqlFileOptions struct {
	ContinueOnError bool `json:"continueOnError"`
}

func dumpIncludesAny(p *DumpParams) bool {
	return p.IncludeTables ||
		p.IncludeViews ||
		p.IncludeProcedures ||
		p.IncludeFunctions ||
		p.IncludeSynonyms ||
		p.IncludeSequences
}

func normalizeDumpParams(p *DumpParams) {
	if p.Mode == "" {
		p.Mode = DumpStructureAndData
	}
	p.Schema = strings.TrimSpace(p.Schema)
	if !dumpIncludesAny(p) {
		p.IncludeTables = true
		p.IncludeViews = true
	}
}

func dumpWantCreateSchema(p DumpParams) bool {
	if p.CreateSchema == nil {
		return true
	}
	return *p.CreateSchema
}

func dumpWantExcludeSystem(p DumpParams) bool {
	if p.ExcludeSystem == nil {
		return true
	}
	return *p.ExcludeSystem
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
	sessionID, database, schema, table, outputPath string,
	opts CsvOptions,
) (string, error) {
	if err := requireRelation(schema, table); err != nil {
		return "", err
	}
	if err := requirePath(outputPath); err != nil {
		return "", err
	}
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		db, stop, err := openDB(ctx, connect, database)
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
	sessionID, database, schema, table, inputPath string,
	opts CsvOptions,
) (string, error) {
	if err := requireRelation(schema, table); err != nil {
		return "", err
	}
	if err := requirePath(inputPath); err != nil {
		return "", err
	}
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		db, stop, err := openDB(ctx, connect, database)
		if err != nil {
			return "", err
		}
		defer stop()
		return inputPath, importCsv(ctx, db, taskID, m, schema, table, inputPath, opts)
	})
}

// DumpSql 异步转储结构/数据。
func (m *Manager) DumpSql(
	parent context.Context,
	connect session.ConnectParams,
	sessionID string,
	params DumpParams,
) (string, error) {
	normalizeDumpParams(&params)
	if strings.TrimSpace(params.Database) == "" {
		return "", errDatabaseRequired
	}
	if err := requirePath(params.OutputPath); err != nil {
		return "", err
	}
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		db, stop, err := openDB(ctx, connect, params.Database)
		if err != nil {
			return "", err
		}
		defer stop()
		return params.OutputPath, dumpSql(ctx, db, taskID, m, params)
	})
}

// ExecSqlFile 异步执行 SQL 文件（按 GO 批拆分，不把 GO 发给服务器）。
func (m *Manager) ExecSqlFile(
	parent context.Context,
	connect session.ConnectParams,
	sessionID, database, inputPath string,
	opts ExecSqlFileOptions,
) (string, error) {
	if strings.TrimSpace(database) == "" {
		return "", errDatabaseRequired
	}
	if err := requirePath(inputPath); err != nil {
		return "", err
	}
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		db, stop, err := openDB(ctx, connect, database)
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

// CancelBySession 取消指定会话下的全部 IO 任务。
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
			slog.Error("sqlserver.io.task.done", "task", taskID, "ok", false, "message", msg)
			m.emitDone(taskID, false, msg, out)
			return
		}
		slog.Info("sqlserver.io.task.done", "task", taskID, "ok", true, "output", out)
		m.emitDone(taskID, true, "completed", out)
	}()
	return taskID, nil
}

func (m *Manager) emitProgress(taskID string, phase TaskPhase, bytes, rows int64, message string) {
	m.emitEvent(map[string]any{
		"type":    "sqlserver.io.progress",
		"taskId":  taskID,
		"phase":   string(phase),
		"bytes":   bytes,
		"rows":    rows,
		"message": message,
	})
}

func (m *Manager) emitDone(taskID string, ok bool, message, outputPath string) {
	payload := map[string]any{
		"type":    "sqlserver.io.done",
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
