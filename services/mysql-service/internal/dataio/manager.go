package dataio

import (
	"context"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"

	"niuma/services/mysql-service/internal/idgen"
	"niuma/services/mysql-service/internal/session"
)

// Emitter 上报 IO 任务事件的回调函数。
type Emitter func(payload map[string]any)

// TaskPhase 任务阶段。
type TaskPhase string

const (
	// PhaseQueued 表示任务已排队等待执行。
	PhaseQueued TaskPhase = "queued"
	// PhaseRunning 表示任务正在执行。
	PhaseRunning TaskPhase = "running"
	// PhaseDone 表示任务已完成。
	PhaseDone TaskPhase = "done"
	// PhaseFailed 表示任务失败。
	PhaseFailed TaskPhase = "failed"
	// PhaseCanceled 表示任务已取消。
	PhaseCanceled TaskPhase = "canceled"
)

// CsvOptions 是 CSV 导入/导出选项。
type CsvOptions struct {
	// Header 是否含标题行。
	Header bool `json:"header"`
	// Delimiter 字段分隔符，默认 ","。
	Delimiter string `json:"delimiter"`
	// NullString 代表 NULL 的字符串；导出时 NULL 写此值，导入时读到此值视为 NULL。
	NullString string `json:"nullString"`
	// Truncate 导入前是否先 TRUNCATE 目标表。
	Truncate bool `json:"truncate"`
	// Encoding 文件编码（当前仅记录，实际写入固定 UTF-8）。
	Encoding string `json:"encoding"`
}

// DumpMode 控制 Dump SQL 内容范围。
type DumpMode string

const (
	// DumpStructureAndData 导出结构与数据。
	DumpStructureAndData DumpMode = "structure_and_data"
	// DumpStructureOnly 仅导出结构。
	DumpStructureOnly DumpMode = "structure_only"
	// DumpDataOnly 仅导出数据。
	DumpDataOnly DumpMode = "data_only"
)

// DumpParams 是 Dump SQL 参数。
type DumpParams struct {
	// Database 目标数据库名（必填）。
	Database string `json:"database"`
	// Tables 指定表名列表；空表示导出库下全部表。
	Tables []string `json:"tables"`
	// Mode 导出模式，默认 structure_and_data。
	Mode DumpMode `json:"mode"`
	// OutputPath 输出文件路径。
	OutputPath string `json:"outputPath"`
	// DropIfExists 在 CREATE TABLE 前写 DROP TABLE IF EXISTS。
	DropIfExists bool `json:"dropIfExists"`
	// TruncateBeforeData 在数据 INSERT 前写 TRUNCATE TABLE。
	TruncateBeforeData bool `json:"truncateBeforeData"`
	// IncludeTables 是否包含普通表。
	IncludeTables bool `json:"includeTables"`
	// IncludeViews 是否包含视图。
	IncludeViews bool `json:"includeViews"`
}

// ExecSqlFileOptions 控制执行 SQL 文件的行为。
type ExecSqlFileOptions struct {
	// ContinueOnError 单条语句失败后是否继续执行后续语句。
	ContinueOnError bool `json:"continueOnError"`
}

// normalizeDumpParams 填充 DumpParams 缺省值。
func normalizeDumpParams(p *DumpParams) {
	if p.Mode == "" {
		p.Mode = DumpStructureAndData
	}
	// 若未明确指定对象类型，默认表+视图都导出
	if !p.IncludeTables && !p.IncludeViews {
		p.IncludeTables = true
		p.IncludeViews = true
	}
}

// Manager 管理旁路落盘异步 IO 任务。
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

// ExportCsv 异步将表数据以 CSV 格式写入本地文件。
func (m *Manager) ExportCsv(
	parent context.Context,
	connect session.ConnectParams,
	sessionID, database, table, outputPath string,
	opts CsvOptions,
) (string, error) {
	if err := requireRelation(database, table); err != nil {
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
		return outputPath, exportCsv(ctx, db, taskID, m, database, table, outputPath, opts)
	})
}

// ImportCsv 异步从本地 CSV 文件批量导入表数据。
func (m *Manager) ImportCsv(
	parent context.Context,
	connect session.ConnectParams,
	sessionID, database, table, inputPath string,
	opts CsvOptions,
) (string, error) {
	if err := requireRelation(database, table); err != nil {
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
		return inputPath, importCsv(ctx, db, taskID, m, database, table, inputPath, opts)
	})
}

// DumpSql 异步转储数据库结构/数据到 .sql 文件。
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
		// Dump 需要访问 information_schema，不限定 database 以保持灵活
		db, stop, err := openDB(ctx, connect, "")
		if err != nil {
			return "", err
		}
		defer stop()
		return params.OutputPath, dumpSql(ctx, db, taskID, m, params)
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

// start 注册任务并在后台 goroutine 中执行，返回 taskID。
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
			slog.Error("mysql.io.task.done", "task", taskID, "ok", false, "message", msg)
			m.emitDone(taskID, false, msg, out)
			return
		}
		slog.Info("mysql.io.task.done", "task", taskID, "ok", true, "output", out)
		m.emitDone(taskID, true, "completed", out)
	}()
	return taskID, nil
}

func (m *Manager) emitProgress(taskID string, phase TaskPhase, bytes, rows int64, message string) {
	m.emitEvent(map[string]any{
		"type":    "mysql.io.progress",
		"taskId":  taskID,
		"phase":   string(phase),
		"bytes":   bytes,
		"rows":    rows,
		"message": message,
	})
}

func (m *Manager) emitDone(taskID string, ok bool, message, outputPath string) {
	payload := map[string]any{
		"type":    "mysql.io.done",
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
