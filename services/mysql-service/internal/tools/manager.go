package tools

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"niuma/services/mysql-service/internal/idgen"
	"niuma/services/mysql-service/internal/session"
)

// Emitter 上报工具任务事件。
type Emitter func(payload map[string]any)

// DetectAllResult 是 tools.detect 返回。
type DetectAllResult struct {
	Mysqldump DetectResult `json:"mysqldump"`
	Mysql     DetectResult `json:"mysql"`
}

// Manager 管理原生客户端子进程任务。
type Manager struct {
	mu       sync.Mutex
	tasks    map[string]*toolTask
	sessions *session.Manager
	ids      idgen.Generator
	emit     Emitter
}

type toolTask struct {
	taskID    string
	sessionID string
	cancel    context.CancelFunc
}

// NewManager 创建原生工具任务管理器。
func NewManager(sessions *session.Manager, ids idgen.Generator, emit Emitter) *Manager {
	return &Manager{
		tasks:    make(map[string]*toolTask),
		sessions: sessions,
		ids:      ids,
		emit:     emit,
	}
}

// DetectAll 探测 mysqldump / mysql 客户端工具。
func (m *Manager) DetectAll(requestPaths PathOverrides) DetectAllResult {
	return DetectAllResult{
		Mysqldump: Detect("mysqldump", requestPaths),
		Mysql:     Detect("mysql", requestPaths),
	}
}

// Dump 异步执行 mysqldump。
func (m *Manager) Dump(
	ctx context.Context,
	connect session.ConnectParams,
	sessionID, database, outputPath string,
	opts DumpOptions,
	requestPaths PathOverrides,
) (string, error) {
	exe, err := m.resolveExe("mysqldump", requestPaths)
	if err != nil {
		return "", err
	}
	opts, err = NormalizeDumpOptions(opts)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(outputPath) == "" {
		outputPath, err = tempOutput("dump", ".sql")
		if err != nil {
			return "", err
		}
	}
	ep, err := PrepareCLI(ctx, connect, database)
	if err != nil {
		return "", err
	}
	args, err := DumpArgs(ep.Host, ep.Port, ep.User, ep.Database, outputPath, opts)
	if err != nil {
		if ep.Stop != nil {
			ep.Stop()
		}
		return "", err
	}
	return m.start(ctx, sessionID, exe, args, ep.Env, stdinFeed{}, outputPath, ep.Stop)
}

// Restore 异步执行 mysql 客户端导入 SQL 文件（stdin）。
func (m *Manager) Restore(
	ctx context.Context,
	connect session.ConnectParams,
	sessionID, database, inputPath string,
	opts RestoreOptions,
	requestPaths PathOverrides,
) (string, error) {
	exe, err := m.resolveExe("mysql", requestPaths)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(inputPath) == "" {
		return "", fmt.Errorf("mysql: inputPath required")
	}
	opts = NormalizeRestoreOptions(opts)
	ep, err := PrepareCLI(ctx, connect, database)
	if err != nil {
		return "", err
	}
	args, err := RestoreArgs(ep.Host, ep.Port, ep.User, ep.Database, opts)
	if err != nil {
		if ep.Stop != nil {
			ep.Stop()
		}
		return "", err
	}
	return m.start(ctx, sessionID, exe, args, ep.Env, stdinFeed{
		path:      inputPath,
		stripGtid: opts.stripGtidEnabled(),
	}, inputPath, ep.Stop)
}

// Cancel 取消任务。
func (m *Manager) Cancel(taskID string) error {
	m.mu.Lock()
	t, ok := m.tasks[taskID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("mysql: tools task not found: %s", taskID)
	}
	if t.cancel != nil {
		t.cancel()
	}
	return nil
}

// CancelBySession 取消会话下全部工具任务。
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

func (m *Manager) resolveExe(toolID string, requestPaths PathOverrides) (string, error) {
	exe, ok := ResolvePath(toolID, requestPaths)
	if !ok {
		return "", fmt.Errorf("%s not found: install MySQL client tools or set path in Settings → Tool Components (mysql-tools)", toolID)
	}
	return exe, nil
}

// stdinFeed 描述还原时喂给 mysql 客户端的输入。
type stdinFeed struct {
	path      string
	stripGtid bool
}

// start 启动子进程；stdin 非空时将文件作为 Stdin（mysql restore）。
func (m *Manager) start(
	parent context.Context,
	sessionID, exe string,
	args, env []string,
	stdin stdinFeed,
	outputPath string,
	tunnelStop func(),
) (string, error) {
	taskID, err := m.ids.NextString()
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return "", err
	}
	runCtx, cancel := context.WithCancel(parent)
	cmd := exec.CommandContext(runCtx, exe, args...)
	cmd.Env = env

	t := &toolTask{taskID: taskID, sessionID: sessionID, cancel: cancel}
	m.mu.Lock()
	m.tasks[taskID] = t
	m.mu.Unlock()

	m.emitProgress(taskID, "queued", "queued")
	go func() {
		defer func() {
			if tunnelStop != nil {
				tunnelStop()
			}
		}()
		m.run(runCtx, taskID, cmd, stdin, outputPath)
	}()
	return taskID, nil
}

func (m *Manager) run(ctx context.Context, taskID string, cmd *exec.Cmd, stdin stdinFeed, outputPath string) {
	defer func() {
		m.mu.Lock()
		delete(m.tasks, taskID)
		m.mu.Unlock()
	}()

	var progressed *progressReader
	if stdin.path != "" {
		f, err := os.Open(stdin.path)
		if err != nil {
			m.emitDone(taskID, false, err.Error(), "")
			return
		}
		defer f.Close()
		total := fileSize(stdin.path)
		// 进度按源文件读取字节统计（在 GTID 过滤之前），不依赖 --verbose。
		progressed = newProgressReader(f, total, taskID, m.emitProgress)
		if stdin.stripGtid {
			cmd.Stdin = newStripGtidReader(progressed)
		} else {
			cmd.Stdin = progressed
		}
		m.emitProgress(taskID, "running", formatRestoreProgress(0, total, 0))
	} else {
		m.emitProgress(taskID, "running", "running dump…")
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.emitDone(taskID, false, err.Error(), "")
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		m.emitDone(taskID, false, err.Error(), "")
		return
	}

	if err := cmd.Start(); err != nil {
		m.emitDone(taskID, false, err.Error(), "")
		return
	}

	// 管道读满后 mysql 可能长时间执行 SQL，进度百分比会暂时不动；心跳提示仍在执行。
	heartbeatDone := make(chan struct{})
	if progressed != nil {
		go m.restoreHeartbeat(ctx, taskID, progressed, heartbeatDone)
	}

	var stderrBuf strings.Builder
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); m.scanLines(taskID, stdout) }()
	go func() {
		defer wg.Done()
		m.scanLinesTo(taskID, stderr, &stderrBuf)
	}()
	wg.Wait()
	close(heartbeatDone)

	err = cmd.Wait()
	select {
	case <-ctx.Done():
		m.emitDone(taskID, false, "canceled", outputPath)
		return
	default:
	}
	if err != nil {
		msg := pickToolErrorLine(stderrBuf.String())
		if msg == "" {
			msg = err.Error()
		}
		// 不记录 args/env，避免 MYSQL_PWD 泄露到日志。
		slog.Error("tools.task.done", "task", taskID, "ok", false, "message", msg)
		m.emitDone(taskID, false, msg, outputPath)
		return
	}
	slog.Info("tools.task.done", "task", taskID, "ok", true)
	m.emitDone(taskID, true, "completed", outputPath)
}

func (m *Manager) restoreHeartbeat(
	ctx context.Context,
	taskID string,
	progressed *progressReader,
	done <-chan struct{},
) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			return
		case <-ticker.C:
			read, total, stalledFor := progressed.snapshot()
			m.emitProgress(taskID, "running", formatRestoreProgress(read, total, stalledFor))
		}
	}
}

func (m *Manager) scanLines(taskID string, r io.Reader) {
	m.scanLinesTo(taskID, r, nil)
}

func (m *Manager) scanLinesTo(taskID string, r io.Reader, buf *strings.Builder) {
	br := bufio.NewReaderSize(r, 64*1024)
	var lastEmit time.Time
	var pending string
	flush := func(force bool) {
		if pending == "" {
			return
		}
		if !force && time.Since(lastEmit) < 80*time.Millisecond {
			return
		}
		m.emitProgress(taskID, "running", pending)
		lastEmit = time.Now()
		pending = ""
	}
	for {
		raw, truncated, err := readToolLine(br, maxToolScanLine)
		if raw != "" || truncated {
			// 超长行多为 mysql --verbose 刷出的巨型 INSERT：必须排空管道，否则 stderr 堵死导致还原假死。
			if truncated || len(raw) >= maxToolScanLine-1 || utf8.RuneCountInString(raw) > maxToolProgressMsgRunes*8 {
				if buf != nil {
					appendCappedLine(buf, truncateRunes(strings.TrimSpace(raw), maxToolProgressMsgRunes), maxToolStderrRetain)
				}
			} else {
				line := strings.TrimSpace(raw)
				if line != "" {
					if buf != nil {
						appendCappedLine(buf, line, maxToolStderrRetain)
					}
					if shouldEmitToolProgress(line) {
						pending = formatToolProgressMessage(line)
						flush(false)
					}
				}
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			slog.Warn("tools.scanLines", "task", taskID, "err", err)
			break
		}
	}
	flush(true)
}

// readToolLine 读取一行；超过 maxKeep 时只保留前缀并继续排空至 '\n'，绝不中断后续读取。
func readToolLine(br *bufio.Reader, maxKeep int) (line string, truncated bool, err error) {
	if maxKeep <= 0 {
		maxKeep = maxToolScanLine
	}
	var out []byte
	for {
		fragment, e := br.ReadSlice('\n')
		if len(fragment) > 0 {
			if len(out) < maxKeep {
				room := maxKeep - len(out)
				if len(fragment) > room {
					out = append(out, fragment[:room]...)
					truncated = true
				} else {
					out = append(out, fragment...)
				}
			} else {
				truncated = true
			}
		}
		if e == nil {
			return strings.TrimRight(string(out), "\r\n"), truncated, nil
		}
		if e == bufio.ErrBufferFull {
			continue
		}
		if e == io.EOF {
			if len(out) == 0 {
				return "", false, io.EOF
			}
			return strings.TrimRight(string(out), "\r\n"), truncated, io.EOF
		}
		return "", false, e
	}
}

func tempOutput(prefix, ext string) (string, error) {
	f, err := os.CreateTemp("", "niuma-mysql-"+prefix+"-*"+ext)
	if err != nil {
		return "", err
	}
	name := f.Name()
	_ = f.Close()
	return name, nil
}

func pickToolErrorLine(stderr string) string {
	lines := strings.Split(stderr, "\n")
	var lastNonEmpty, preferred string
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		lastNonEmpty = line
		lower := strings.ToLower(line)
		if strings.Contains(lower, "error") || strings.Contains(lower, "fatal") {
			preferred = line
		}
	}
	if preferred != "" {
		return preferred
	}
	return lastNonEmpty
}

func (m *Manager) emitProgress(taskID, phase, message string) {
	m.emitEvent(map[string]any{
		"type":    "mysql.tools.progress",
		"taskId":  taskID,
		"phase":   phase,
		"message": message,
	})
}

func (m *Manager) emitDone(taskID string, ok bool, message, outputPath string) {
	payload := map[string]any{
		"type":    "mysql.tools.done",
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
