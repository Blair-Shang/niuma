package dataio

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"

	"niuma/services/clickhouse-service/internal/idgen"
	"niuma/services/clickhouse-service/internal/session"
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

// CsvOptions 是 CSV/多格式导入/导出选项。
type CsvOptions struct {
	// Header 是否含标题行（对应 CSVWithNames / TSVWithNames）。
	Header bool `json:"header"`
	// Delimiter 字段分隔符，默认 ","（仅 CSV）。
	Delimiter string `json:"delimiter"`
	// NullString 代表 NULL 的字符串；导出时 NULL 写此值，导入时读到此值视为 NULL。
	NullString string `json:"nullString"`
	// Truncate 导入前是否先 TRUNCATE 目标表。
	Truncate bool `json:"truncate"`
	// Encoding 文件编码：utf-8（默认）或 gbk。
	Encoding string `json:"encoding"`
	// ColumnMap 列映射：CSV 表头 → 表列名；未列出的源列跳过。有映射时走 PrepareBatch。
	ColumnMap map[string]string `json:"columnMap"`
	// Format 导入格式：csv | tsv | json_each_row | parquet。
	Format string `json:"format"`
	// SkipRows 跳过文件开头的数据行数（不含表头，由 FORMAT WithNames 处理表头）。
	SkipRows int `json:"skipRows"`
	// MaxErrors 允许的错误行数（input_format_allow_errors_num）。
	MaxErrors uint64 `json:"maxErrors"`
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
	// Tables 指定表/视图/MV 名列表；空表示按 Include* 导出库下全部匹配对象。
	Tables []string `json:"tables"`
	// Mode 导出模式，默认 structure_and_data。
	Mode DumpMode `json:"mode"`
	// OutputPath 输出文件路径。
	OutputPath string `json:"outputPath"`
	// DropIfExists 在 CREATE 前写 DROP IF EXISTS。
	DropIfExists bool `json:"dropIfExists"`
	// TruncateBeforeData 在数据 INSERT 前写 TRUNCATE TABLE。
	TruncateBeforeData bool `json:"truncateBeforeData"`
	// IncludeCreateDatabase 是否写入 CREATE DATABASE IF NOT EXISTS。
	IncludeCreateDatabase bool `json:"includeCreateDatabase"`
	// IncludeTables 是否包含普通表。
	IncludeTables bool `json:"includeTables"`
	// IncludeViews 是否包含视图。
	IncludeViews bool `json:"includeViews"`
	// IncludeMaterializedViews 是否包含物化视图。
	IncludeMaterializedViews bool `json:"includeMaterializedViews"`
	// IncludeDictionaries 是否包含字典（仅结构，无数据）。
	IncludeDictionaries bool `json:"includeDictionaries"`
}

// ExecSqlFileOptions 控制执行 SQL 文件的行为。
type ExecSqlFileOptions struct {
	// ContinueOnError 单条语句失败后是否继续执行后续语句。
	ContinueOnError bool `json:"continueOnError"`
}

func normalizeDumpParams(p *DumpParams) {
	if p.Mode == "" {
		p.Mode = DumpStructureAndData
	}
	hasAny := p.IncludeTables || p.IncludeViews || p.IncludeMaterializedViews || p.IncludeDictionaries
	if !hasAny {
		p.IncludeTables = true
		p.IncludeViews = true
		p.IncludeMaterializedViews = true
		p.IncludeDictionaries = true
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

// ImportCsv 异步从本地文件导入表数据。
// 无自定义列映射时优先 HTTP INSERT … FORMAT；否则（或隧道会话）走 PrepareBatch。
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
	opts = defaultCsvOptions(opts)
	format := resolveImportFormat(opts)
	if needsBatchColumnMap(opts) && !supportsBatchImport(opts) {
		return "", fmt.Errorf("clickhouse: format %s does not support column mapping; clear mapping or use CSV/TSV", format)
	}
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		if opts.Truncate {
			db, stopDB, err := openDB(ctx, connect, database)
			if err != nil {
				return "", err
			}
			qn := quoteIdent(database) + "." + quoteIdent(table)
			if _, err := db.ExecContext(ctx, "TRUNCATE TABLE "+qn); err != nil {
				stopDB()
				return "", fmt.Errorf("clickhouse: truncate before import: %w", err)
			}
			stopDB()
			m.emitProgress(taskID, PhaseRunning, 0, 0, "truncated")
		}
		// FORMAT 快路径：避免重复 TRUNCATE
		formatOpts := opts
		formatOpts.Truncate = false
		if canUseFormatHTTP(connect, formatOpts) {
			err := importWithFormatHTTP(ctx, connect, taskID, m, database, table, inputPath, formatOpts)
			if err == nil {
				return inputPath, nil
			}
			// Parquet 无 batch 回退
			if format == FormatParquet {
				return "", err
			}
			m.emitProgress(taskID, PhaseRunning, 0, 0, "format http failed, fallback batch: "+err.Error())
		}
		if !supportsBatchImport(formatOpts) {
			return "", fmt.Errorf("clickhouse: format %s requires HTTP interface (no SSH tunnel); reconnect with protocol=http or disable tunnel", format)
		}
		conn, stop, err := openNativeConn(ctx, connect, database)
		if err != nil {
			return "", err
		}
		defer stop()
		return inputPath, importCsvNative(ctx, conn, taskID, m, database, table, inputPath, formatOpts)
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
	if isProtectedDatabase(params.Database) {
		return "", fmt.Errorf("clickhouse: refusing to dump protected database %q", strings.TrimSpace(params.Database))
	}
	if err := requirePath(params.OutputPath); err != nil {
		return "", err
	}
	normalizeDumpParams(&params)
	return m.start(parent, sessionID, func(ctx context.Context, taskID string) (string, error) {
		db, stop, err := openDB(ctx, connect, params.Database)
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
	if isProtectedDatabase(database) {
		return "", fmt.Errorf("clickhouse: refusing to restore into protected database %q", strings.TrimSpace(database))
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
		return inputPath, execSqlFile(ctx, db, taskID, m, inputPath, database, opts)
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
			slog.Error("clickhouse.io.task.done", "task", taskID, "ok", false, "message", msg)
			m.emitDone(taskID, false, msg, out)
			return
		}
		slog.Info("clickhouse.io.task.done", "task", taskID, "ok", true, "output", out)
		m.emitDone(taskID, true, "completed", out)
	}()
	return taskID, nil
}

func (m *Manager) emitProgress(taskID string, phase TaskPhase, bytes, rows int64, message string) {
	m.emitEvent(map[string]any{
		"type":    "clickhouse.io.progress",
		"taskId":  taskID,
		"phase":   string(phase),
		"bytes":   bytes,
		"rows":    rows,
		"message": message,
	})
}

func (m *Manager) emitDone(taskID string, ok bool, message, outputPath string) {
	payload := map[string]any{
		"type":    "clickhouse.io.done",
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
