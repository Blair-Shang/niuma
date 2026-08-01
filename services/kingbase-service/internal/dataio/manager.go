package dataio

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"

	"niuma/services/kingbase-service/internal/idgen"
	"niuma/services/kingbase-service/internal/session"
)

// 确保 fmt 用于 csvWithClause。

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
	Header     bool   `json:"header"`
	Delimiter  string `json:"delimiter"`
	NullString string `json:"nullString"`
	Truncate   bool   `json:"truncate"`
	Encoding   string `json:"encoding"`
}

// DumpMode 控制 Dump SQL 内容。
type DumpMode string

const (
	DumpStructureAndData DumpMode = "structure_and_data"
	DumpStructureOnly    DumpMode = "structure_only"
	DumpDataOnly         DumpMode = "data_only"
)

// DumpParams 是 Dump SQL 参数（对齐 Navicat / DBeaver 常用库转储选项）。
type DumpParams struct {
	Database   string   `json:"database"`
	Schema     string   `json:"schema"`
	Tables     []string `json:"tables"`
	Mode       DumpMode `json:"mode"`
	OutputPath string   `json:"outputPath"`

	// 对象类型；若全为 false，normalize 后默认表+视图+物化视图+序列+函数+过程+触发器。
	IncludeTables     bool `json:"includeTables"`
	IncludeViews      bool `json:"includeViews"`
	IncludeMatViews   bool `json:"includeMatViews"`
	IncludeSequences  bool `json:"includeSequences"`
	IncludeFunctions  bool `json:"includeFunctions"`
	IncludeProcedures bool `json:"includeProcedures"`
	IncludeTriggers   bool `json:"includeTriggers"`

	// DropIfExists 在 CREATE 前输出 DROP … IF EXISTS CASCADE。
	DropIfExists bool `json:"dropIfExists"`
	// TruncateBeforeData 在 COPY 数据前输出 TRUNCATE（已有表导数据时有用）。
	TruncateBeforeData bool `json:"truncateBeforeData"`

	// CreateSchema / ExcludeSystem 默认 true（nil 时）。
	CreateSchema  *bool `json:"createSchema"`
	ExcludeSystem *bool `json:"excludeSystem"`
}

func dumpIncludesAny(p *DumpParams) bool {
	return p.IncludeTables ||
		p.IncludeViews ||
		p.IncludeMatViews ||
		p.IncludeSequences ||
		p.IncludeFunctions ||
		p.IncludeProcedures ||
		p.IncludeTriggers
}

func normalizeDumpParams(p *DumpParams) {
	if p.Mode == "" {
		p.Mode = DumpStructureAndData
	}
	if !dumpIncludesAny(p) {
		p.IncludeTables = true
		p.IncludeViews = true
		p.IncludeMatViews = true
		p.IncludeSequences = true
		p.IncludeFunctions = true
		p.IncludeProcedures = true
		p.IncludeTriggers = true
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

func dumpRelationTypes(p DumpParams) []string {
	types := make([]string, 0, 3)
	if p.IncludeTables {
		types = append(types, "table")
	}
	if p.IncludeViews {
		types = append(types, "view")
	}
	if p.IncludeMatViews {
		types = append(types, "materialized_view")
	}
	return types
}

// Manager 管理旁路落盘异步任务。
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

// ExportCsv 异步 COPY TO STDOUT 写本地 CSV。
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
		pool, stop, err := openPool(ctx, connect, database)
		if err != nil {
			return "", err
		}
		defer stop()
		return outputPath, exportCsv(ctx, pool, taskID, m, schema, table, outputPath, opts)
	})
}

// ImportCsv 异步从本地 CSV COPY FROM STDIN。
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
		pool, stop, err := openPool(ctx, connect, database)
		if err != nil {
			return "", err
		}
		defer stop()
		return inputPath, importCsv(ctx, pool, taskID, m, schema, table, inputPath, opts)
	})
}

// DumpSql 异步转储结构/数据到 .sql 文件。
func (m *Manager) DumpSql(
	parent context.Context,
	connect session.ConnectParams,
	sessionID string,
	params DumpParams,
) (string, error) {
	if strings.TrimSpace(params.Database) == "" {
		return "", errDatabaseRequired
	}
	if err := requirePath(params.OutputPath); err != nil {
		return "", err
	}
	normalizeDumpParams(&params)
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		pool, stop, err := openPool(ctx, connect, params.Database)
		if err != nil {
			return "", err
		}
		defer stop()
		return params.OutputPath, dumpSql(ctx, pool, taskID, m, params)
	})
}

// ExecSqlFile 异步执行本地 SQL 文件。
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
		pool, stop, err := openPool(ctx, connect, database)
		if err != nil {
			return "", err
		}
		defer stop()
		return inputPath, execSqlFile(ctx, pool, taskID, m, inputPath, opts)
	})
}

// Cancel 取消任务。
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
			slog.Error("io.task.done", "task", taskID, "ok", false, "message", msg)
			m.emitDone(taskID, false, msg, out)
			return
		}
		slog.Info("io.task.done", "task", taskID, "ok", true, "output", out)
		m.emitDone(taskID, true, "completed", out)
	}()
	return taskID, nil
}

func openPool(ctx context.Context, connect session.ConnectParams, database string) (*pgxpool.Pool, func(), error) {
	p := connect
	if db := strings.TrimSpace(database); db != "" {
		p.Options.Database = db
	}
	pool, tunnelStop, err := session.Connect(ctx, p)
	if err != nil {
		return nil, nil, err
	}
	return pool, func() {
		pool.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
	}, nil
}

func (m *Manager) emitProgress(taskID string, phase TaskPhase, bytes, rows int64, message string) {
	m.emitEvent(map[string]any{
		"type":    "kingbase.io.progress",
		"taskId":  taskID,
		"phase":   string(phase),
		"bytes":   bytes,
		"rows":    rows,
		"message": message,
	})
}

func (m *Manager) emitDone(taskID string, ok bool, message, outputPath string) {
	payload := map[string]any{
		"type":    "kingbase.io.done",
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

func csvWithClause(opts CsvOptions) string {
	delim := opts.Delimiter
	if delim == "" {
		delim = ","
	}
	if len(delim) > 1 {
		delim = delim[:1]
	}
	parts := []string{"FORMAT csv"}
	if opts.Header {
		parts = append(parts, "HEADER true")
	}
	parts = append(parts, fmt.Sprintf("DELIMITER %s", quoteLiteral(delim)))
	if opts.NullString != "" {
		parts = append(parts, fmt.Sprintf("NULL %s", quoteLiteral(opts.NullString)))
	}
	return strings.Join(parts, ", ")
}

func quoteLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func defaultCsvOptions(opts CsvOptions) CsvOptions {
	if opts.Delimiter == "" {
		opts.Delimiter = ","
	}
	return opts
}
