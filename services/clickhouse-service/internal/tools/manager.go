package tools

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"niuma/services/clickhouse-service/internal/idgen"
	"niuma/services/clickhouse-service/internal/session"
)

// Emitter 上报工具任务事件。
type Emitter func(payload map[string]any)

// DumpOptions 控制 clickhouse-client 转储内容。
type DumpOptions struct {
	Mode   string   `json:"mode"` // all | structure_only | data_only
	Tables []string `json:"tables"`
}

// RestoreOptions 控制还原。
type RestoreOptions struct {
	Multiquery *bool `json:"multiquery"`
}

// Manager 管理原生客户端子进程任务。
type Manager struct {
	mu    sync.Mutex
	tasks map[string]*toolTask
	ids   idgen.Generator
	emit  Emitter
}

type toolTask struct {
	taskID string
	cancel context.CancelFunc
}

// NewManager 创建原生工具任务管理器。
func NewManager(ids idgen.Generator, emit Emitter) *Manager {
	return &Manager{
		tasks: make(map[string]*toolTask),
		ids:   ids,
		emit:  emit,
	}
}

func (m *Manager) resolveExe(requestPaths PathOverrides) (string, error) {
	exe, ok := ResolvePath("clickhouse-client", requestPaths)
	if !ok {
		return "", fmt.Errorf("clickhouse-client not found: install ClickHouse client or set path in Settings → Tool Components (clickhouse-tools)")
	}
	return exe, nil
}

// NormalizeDumpOptions 规范化 dump 选项。
func NormalizeDumpOptions(opts DumpOptions) (DumpOptions, error) {
	mode := strings.ToLower(strings.TrimSpace(opts.Mode))
	if mode == "" {
		mode = "all"
	}
	switch mode {
	case "all", "structure_only", "data_only":
	default:
		return opts, fmt.Errorf("invalid dump mode: %s", opts.Mode)
	}
	opts.Mode = mode
	clean := make([]string, 0, len(opts.Tables))
	seen := map[string]struct{}{}
	for _, t := range opts.Tables {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		clean = append(clean, t)
	}
	opts.Tables = clean
	return opts, nil
}

// Dump 异步执行 clickhouse-client 库级转储。
func (m *Manager) Dump(
	ctx context.Context,
	connect session.ConnectParams,
	database, outputPath string,
	opts DumpOptions,
	requestPaths PathOverrides,
) (string, error) {
	exe, err := m.resolveExe(requestPaths)
	if err != nil {
		return "", err
	}
	connect, err = prepareNativeConnect(connect)
	if err != nil {
		return "", err
	}
	opts, err = NormalizeDumpOptions(opts)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(outputPath) == "" {
		outputPath, err = tempOutput("ch-dump", ".sql")
		if err != nil {
			return "", err
		}
	}
	database = strings.TrimSpace(database)
	if database == "" {
		database = connect.Options.DatabaseOrDefault()
	}
	if isProtectedDatabase(database) {
		return "", fmt.Errorf("refusing to dump protected database %q; use a user database", database)
	}

	taskID, err := m.ids.NextString()
	if err != nil {
		return "", err
	}
	runCtx, cancel := context.WithCancel(ctx)
	t := &toolTask{taskID: taskID, cancel: cancel}
	m.mu.Lock()
	m.tasks[taskID] = t
	m.mu.Unlock()

	m.emitProgress(taskID, "queued", "queued")
	go func() {
		defer func() {
			m.mu.Lock()
			delete(m.tasks, taskID)
			m.mu.Unlock()
		}()
		m.runDump(runCtx, taskID, exe, connect, database, outputPath, opts)
	}()
	return taskID, nil
}

// Restore 异步执行 clickhouse-client --multiquery 还原 SQL 文件。
func (m *Manager) Restore(
	ctx context.Context,
	connect session.ConnectParams,
	database, inputPath string,
	opts RestoreOptions,
	requestPaths PathOverrides,
) (string, error) {
	exe, err := m.resolveExe(requestPaths)
	if err != nil {
		return "", err
	}
	connect, err = prepareNativeConnect(connect)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(inputPath) == "" {
		return "", fmt.Errorf("inputPath required")
	}
	if !fileExists(inputPath) {
		return "", fmt.Errorf("input file not found: %s", inputPath)
	}
	database = strings.TrimSpace(database)
	if database == "" {
		database = connect.Options.DatabaseOrDefault()
	}
	if isProtectedDatabase(database) {
		return "", fmt.Errorf("refusing to restore into protected database %q", database)
	}
	args := clientArgs(exe, connect, database)
	multiquery := true
	if opts.Multiquery != nil {
		multiquery = *opts.Multiquery
	}
	if multiquery {
		args = append(args, "--multiquery")
	}

	taskID, err := m.ids.NextString()
	if err != nil {
		return "", err
	}
	runCtx, cancel := context.WithCancel(ctx)
	t := &toolTask{taskID: taskID, cancel: cancel}
	m.mu.Lock()
	m.tasks[taskID] = t
	m.mu.Unlock()

	m.emitProgress(taskID, "queued", "queued")
	go func() {
		defer func() {
			m.mu.Lock()
			delete(m.tasks, taskID)
			m.mu.Unlock()
		}()
		m.runRestore(runCtx, taskID, exe, args, inputPath)
	}()
	return taskID, nil
}

// Cancel 取消任务。
func (m *Manager) Cancel(taskID string) error {
	m.mu.Lock()
	t, ok := m.tasks[taskID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("task not found: %s", taskID)
	}
	t.cancel()
	return nil
}

func (m *Manager) runDump(ctx context.Context, taskID, exe string, connect session.ConnectParams, database, outputPath string, opts DumpOptions) {
	m.emitProgress(taskID, "running", "listing tables…")
	tables := opts.Tables
	if len(tables) == 0 {
		listed, err := m.listTables(ctx, exe, connect, database)
		if err != nil {
			m.emitDone(taskID, false, err.Error(), outputPath)
			return
		}
		tables = listed
	}
	if len(tables) == 0 {
		m.emitDone(taskID, false, "no tables to dump", outputPath)
		return
	}

	out, err := os.Create(outputPath)
	if err != nil {
		m.emitDone(taskID, false, err.Error(), outputPath)
		return
	}
	defer out.Close()

	header := fmt.Sprintf(
		"-- NiuMa clickhouse-client dump\n-- format: niuma-clickhouse-cli-dump/1\n-- database: %s\n-- generated: %s\n-- mode: %s\n-- note: DDL ends with ';' for --multiquery restore; object names are unqualified\n-- note: not for HTTP/SSH-tunnel sessions; use built-in engine instead\n\n",
		database,
		time.Now().UTC().Format(time.RFC3339),
		opts.Mode,
	)
	if _, err := io.WriteString(out, header); err != nil {
		m.emitDone(taskID, false, err.Error(), outputPath)
		return
	}
	if _, err := io.WriteString(out, "CREATE DATABASE IF NOT EXISTS `"+escapeIdent(database)+"`;\n\n"); err != nil {
		m.emitDone(taskID, false, err.Error(), outputPath)
		return
	}

	includeStructure := opts.Mode == "all" || opts.Mode == "structure_only"
	includeData := opts.Mode == "all" || opts.Mode == "data_only"
	total := len(tables)

	for i, table := range tables {
		select {
		case <-ctx.Done():
			m.emitDone(taskID, false, "canceled", outputPath)
			return
		default:
		}
		m.emitProgress(taskID, "running", fmt.Sprintf("dumping %s (%d/%d)", table, i+1, total))

		if includeStructure {
			ddl, err := m.showCreateTable(ctx, exe, connect, database, table)
			if err != nil {
				m.emitDone(taskID, false, err.Error(), outputPath)
				return
			}
			ddl = stripDatabaseQualifier(ddl, database)
			block := fmt.Sprintf("-- Object: %s\n%s\n", table, ensureStatement(ddl))
			if _, err := io.WriteString(out, block); err != nil {
				m.emitDone(taskID, false, err.Error(), outputPath)
				return
			}
		}
		if includeData {
			if _, err := io.WriteString(out, fmt.Sprintf("-- Data: %s\n", table)); err != nil {
				m.emitDone(taskID, false, err.Error(), outputPath)
				return
			}
			if err := m.appendSQLInsert(ctx, exe, connect, database, table, out); err != nil {
				m.emitDone(taskID, false, err.Error(), outputPath)
				return
			}
			if _, err := io.WriteString(out, "\n"); err != nil {
				m.emitDone(taskID, false, err.Error(), outputPath)
				return
			}
		}
	}

	select {
	case <-ctx.Done():
		m.emitDone(taskID, false, "canceled", outputPath)
		return
	default:
	}
	m.emitDone(taskID, true, "ok", outputPath)
}

func (m *Manager) showCreateTable(ctx context.Context, exe string, connect session.ConnectParams, database, table string) (string, error) {
	args := clientArgs(exe, connect, database)
	qual := "`" + escapeIdent(database) + "`.`" + escapeIdent(table) + "`"
	args = append(args, "--query", "SHOW CREATE TABLE "+qual)
	cmd := exec.CommandContext(ctx, exe, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("SHOW CREATE %s: %s", table, msg)
	}
	ddl := strings.TrimSpace(stdout.String())
	if ddl == "" {
		return "", fmt.Errorf("SHOW CREATE %s: empty result", table)
	}
	return ddl, nil
}

func (m *Manager) appendSQLInsert(ctx context.Context, exe string, connect session.ConnectParams, database, table string, out io.Writer) error {
	args := clientArgs(exe, connect, database)
	qual := "`" + escapeIdent(database) + "`.`" + escapeIdent(table) + "`"
	// FORMAT 子句写在 query 末尾；输出为可执行 INSERT（通常已带分号）
	args = append(args, "--query", "SELECT * FROM "+qual+" FORMAT SQLInsert")
	cmd := exec.CommandContext(ctx, exe, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var stderrBuf strings.Builder
	cmd.Stderr = &stderrBuf
	if err := cmd.Start(); err != nil {
		return err
	}
	// 流式写出，并把 `db`. 限定剥离以便换库还原
	stripped := newQualifierStripWriter(out, database)
	if _, err := io.Copy(stripped, stdout); err != nil {
		_ = cmd.Wait()
		return err
	}
	if err := stripped.Flush(); err != nil {
		_ = cmd.Wait()
		return err
	}
	if err := cmd.Wait(); err != nil {
		msg := strings.TrimSpace(stderrBuf.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("SQLInsert %s: %s", table, msg)
	}
	return nil
}

func (m *Manager) runRestore(ctx context.Context, taskID, exe string, args []string, inputPath string) {
	f, err := os.Open(inputPath)
	if err != nil {
		m.emitDone(taskID, false, err.Error(), "")
		return
	}
	defer f.Close()
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Stdin = f
	cmd.Stdout = io.Discard
	var stderrBuf strings.Builder
	stderr, err := cmd.StderrPipe()
	if err != nil {
		m.emitDone(taskID, false, err.Error(), "")
		return
	}
	m.emitProgress(taskID, "running", "running restore…")
	if err := cmd.Start(); err != nil {
		m.emitDone(taskID, false, err.Error(), "")
		return
	}
	sc := bufio.NewScanner(stderr)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		stderrBuf.WriteString(line)
		stderrBuf.WriteByte('\n')
		m.emitProgress(taskID, "running", truncate(line, 500))
	}
	err = cmd.Wait()
	select {
	case <-ctx.Done():
		m.emitDone(taskID, false, "canceled", "")
		return
	default:
	}
	if err != nil {
		msg := strings.TrimSpace(stderrBuf.String())
		if msg == "" {
			msg = err.Error()
		}
		m.emitDone(taskID, false, truncate(msg, 2000), "")
		return
	}
	m.emitDone(taskID, true, "ok", "")
}

func (m *Manager) listTables(ctx context.Context, exe string, connect session.ConnectParams, database string) ([]string, error) {
	args := clientArgs(exe, connect, database)
	q := fmt.Sprintf(
		"SELECT name FROM system.tables WHERE database = %s AND is_temporary = 0 AND engine NOT LIKE '%%View%%' AND engine != 'Dictionary' ORDER BY name",
		quoteLit(database),
	)
	args = append(args, "--query", q)
	cmd := exec.CommandContext(ctx, exe, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("list tables: %s", msg)
	}
	var out []string
	sc := bufio.NewScanner(bytes.NewReader(stdout.Bytes()))
	for sc.Scan() {
		name := strings.TrimSpace(sc.Text())
		if name != "" {
			out = append(out, name)
		}
	}
	return out, nil
}

func clientArgs(exe string, connect session.ConnectParams, database string) []string {
	args := make([]string, 0, 16)
	base := strings.ToLower(filepath.Base(exe))
	if base == "clickhouse" || base == "clickhouse.exe" {
		args = append(args, "client")
	}
	host := strings.TrimSpace(connect.HostAddress)
	if host == "" {
		host = "127.0.0.1"
	}
	args = append(args,
		"--host", host,
		"--port", strconv.Itoa(connect.PortOrDefault()),
	)
	if u := strings.TrimSpace(connect.LoginAccount); u != "" {
		args = append(args, "--user", u)
	}
	if connect.Secret != "" {
		args = append(args, "--password", connect.Secret)
	}
	if database != "" {
		args = append(args, "--database", database)
	}
	if connect.Options.Secure != nil && *connect.Options.Secure {
		args = append(args, "--secure")
	} else {
		mode := strings.ToLower(strings.TrimSpace(connect.Options.SSLMode))
		switch mode {
		case "require", "required", "verify-ca", "verify_ca", "verify-full", "verify_identity", "verify-identity", "true":
			args = append(args, "--secure")
		}
	}
	return args
}

// qualifierStripWriter 流式剥离 `database`. 前缀，便于换库还原。
type qualifierStripWriter struct {
	w      io.Writer
	needle []byte
	carry  []byte
}

func newQualifierStripWriter(w io.Writer, database string) *qualifierStripWriter {
	db := strings.TrimSpace(database)
	needle := []byte("`" + escapeIdent(db) + "`.")
	return &qualifierStripWriter{w: w, needle: needle}
}

func (w *qualifierStripWriter) Write(p []byte) (int, error) {
	if len(w.needle) == 0 {
		return w.w.Write(p)
	}
	buf := append(w.carry, p...)
	w.carry = nil
	for {
		idx := bytes.Index(buf, w.needle)
		if idx < 0 {
			keep := len(w.needle) - 1
			if keep < 0 {
				keep = 0
			}
			if len(buf) > keep {
				if _, err := w.w.Write(buf[:len(buf)-keep]); err != nil {
					return 0, err
				}
				w.carry = append([]byte(nil), buf[len(buf)-keep:]...)
			} else {
				w.carry = append([]byte(nil), buf...)
			}
			return len(p), nil
		}
		if _, err := w.w.Write(buf[:idx]); err != nil {
			return 0, err
		}
		buf = buf[idx+len(w.needle):]
	}
}

func (w *qualifierStripWriter) Flush() error {
	if len(w.carry) == 0 {
		return nil
	}
	_, err := w.w.Write(w.carry)
	w.carry = nil
	return err
}

func quoteLit(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "\\'") + "'"
}

func escapeIdent(s string) string {
	return strings.ReplaceAll(s, "`", "``")
}

func tempOutput(prefix, ext string) (string, error) {
	f, err := os.CreateTemp("", prefix+"-*"+ext)
	if err != nil {
		return "", err
	}
	path := f.Name()
	_ = f.Close()
	return path, nil
}

func (m *Manager) emitProgress(taskID, phase, message string) {
	if m.emit == nil {
		return
	}
	m.emit(map[string]any{
		"type":      "clickhouse.tools.progress",
		"taskId":    taskID,
		"phase":     phase,
		"message":   message,
		"timestamp": time.Now().UnixMilli(),
	})
}

func (m *Manager) emitDone(taskID string, ok bool, message, outputPath string) {
	if m.emit == nil {
		return
	}
	payload := map[string]any{
		"type":      "clickhouse.tools.done",
		"taskId":    taskID,
		"ok":        ok,
		"message":   message,
		"timestamp": time.Now().UnixMilli(),
	}
	if outputPath != "" {
		payload["outputPath"] = outputPath
	}
	m.emit(payload)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
