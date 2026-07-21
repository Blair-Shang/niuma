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

	"niuma/services/vastbase-service/internal/idgen"
	"niuma/services/vastbase-service/internal/session"
)

// Emitter 上报工具任务事件。
type Emitter func(payload map[string]any)

// DetectAllResult 是 tools.detect 返回（Vastbase 官方工具优先）。
type DetectAllResult struct {
	VbDump    DetectResult `json:"vb_dump"`
	VbRestore DetectResult `json:"vb_restore"`
	Vsql      DetectResult `json:"vsql"`
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

// DetectAll 探测 Vastbase 官方客户端工具。
func (m *Manager) DetectAll(requestPaths PathOverrides) DetectAllResult {
	return DetectAllResult{
		VbDump:    Detect("vb_dump", requestPaths),
		VbRestore: Detect("vb_restore", requestPaths),
		Vsql:      Detect("vsql", requestPaths),
	}
}

// Dump 异步执行 vb_dump。
func (m *Manager) Dump(
	ctx context.Context,
	connect session.ConnectParams,
	sessionID, database, outputPath string,
	opts DumpOptions,
	requestPaths PathOverrides,
) (string, error) {
	exe, err := m.resolveExe("vb_dump", requestPaths)
	if err != nil {
		return "", err
	}
	opts, err = NormalizeDumpOptions(opts)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(outputPath) == "" {
		if opts.Format == DumpFormatDirectory {
			outputPath, err = tempDirOutput("dump")
		} else {
			outputPath, err = tempOutput("dump", dumpTempExt(opts.Format))
		}
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
	return m.start(ctx, sessionID, exe, args, ep.Env, outputPath, ep.Stop)
}

// Restore 异步执行 vb_restore。
func (m *Manager) Restore(
	ctx context.Context,
	connect session.ConnectParams,
	sessionID, database, inputPath string,
	opts RestoreOptions,
	requestPaths PathOverrides,
) (string, error) {
	exe, err := m.resolveExe("vb_restore", requestPaths)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(inputPath) == "" {
		return "", fmt.Errorf("vastbase: inputPath required")
	}
	ep, err := PrepareCLI(ctx, connect, database)
	if err != nil {
		return "", err
	}
	args, err := RestoreArgs(ep.Host, ep.Port, ep.User, ep.Database, inputPath, opts)
	if err != nil {
		if ep.Stop != nil {
			ep.Stop()
		}
		return "", err
	}
	return m.start(ctx, sessionID, exe, args, ep.Env, inputPath, ep.Stop)
}

// ExecSQLFile 优先用 vsql -f，其次 psql。
func (m *Manager) ExecSQLFile(
	ctx context.Context,
	connect session.ConnectParams,
	sessionID, database, inputPath string,
	requestPaths PathOverrides,
) (string, error) {
	exe, err := m.resolveExe("vsql", requestPaths)
	if err != nil {
		exe, err = m.resolveExe("psql", requestPaths)
		if err != nil {
			return "", fmt.Errorf("vsql/psql not found: configure path in Settings → Tool Components")
		}
	}
	if strings.TrimSpace(inputPath) == "" {
		return "", fmt.Errorf("vastbase: inputPath required")
	}
	ep, err := PrepareCLI(ctx, connect, database)
	if err != nil {
		return "", err
	}
	args := VsqlFileArgs(ep.Host, ep.Port, ep.User, ep.Database, inputPath)
	return m.start(ctx, sessionID, exe, args, ep.Env, inputPath, ep.Stop)
}

// Cancel 取消任务。
func (m *Manager) Cancel(taskID string) error {
	m.mu.Lock()
	t, ok := m.tasks[taskID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("vastbase: tools task not found: %s", taskID)
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
		switch toolID {
		case "vb_dump", "vb_restore", "vsql":
			return "", fmt.Errorf("%s not found: install Vastbase client tools or set path in Settings → Tool Components (vastbase-tools)", toolID)
		default:
			return "", fmt.Errorf("%s not found: configure path in Settings → Tool Components", toolID)
		}
	}
	return exe, nil
}

func (m *Manager) start(parent context.Context, sessionID, exe string, args, env []string, outputPath string, tunnelStop func()) (string, error) {
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
		m.run(runCtx, taskID, cmd, outputPath)
	}()
	return taskID, nil
}

func (m *Manager) run(ctx context.Context, taskID string, cmd *exec.Cmd, outputPath string) {
	defer func() {
		m.mu.Lock()
		delete(m.tasks, taskID)
		m.mu.Unlock()
	}()

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

	m.emitProgress(taskID, "running", "running")
	if err := cmd.Start(); err != nil {
		m.emitDone(taskID, false, err.Error(), "")
		return
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

	err = cmd.Wait()
	select {
	case <-ctx.Done():
		m.emitDone(taskID, false, "canceled", outputPath)
		return
	default:
	}
	if err != nil {
		msg := rewriteToolFailure(stderrBuf.String())
		if msg == "" {
			msg = err.Error()
		}
		slog.Error("tools.task.done", "task", taskID, "ok", false, "message", msg)
		m.emitDone(taskID, false, msg, outputPath)
		return
	}
	slog.Info("tools.task.done", "task", taskID, "ok", true)
	m.emitDone(taskID, true, "completed", outputPath)
}

func (m *Manager) scanLines(taskID string, r io.Reader) {
	m.scanLinesTo(taskID, r, nil)
}

func (m *Manager) scanLinesTo(taskID string, r io.Reader, buf *strings.Builder) {
	scanner := bufio.NewScanner(r)
	// pg_dump 偶发长 SQL detail 行，放宽默认 64KiB 限制。
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if buf != nil {
			if buf.Len() > 0 {
				buf.WriteByte('\n')
			}
			buf.WriteString(line)
		}
		m.emitProgress(taskID, "running", line)
	}
}

func tempOutput(prefix, ext string) (string, error) {
	f, err := os.CreateTemp("", "niuma-vast-"+prefix+"-*"+ext)
	if err != nil {
		return "", err
	}
	name := f.Name()
	_ = f.Close()
	return name, nil
}

// tempDirOutput 为 directory 格式准备空目录路径：先占名再删除，由 vb_dump 创建目录。
func tempDirOutput(prefix string) (string, error) {
	dir, err := os.MkdirTemp("", "niuma-vast-"+prefix+"-*")
	if err != nil {
		return "", err
	}
	if err := os.Remove(dir); err != nil {
		return "", err
	}
	return dir, nil
}

func (m *Manager) emitProgress(taskID, phase, message string) {
	m.emitEvent(map[string]any{
		"type":    "vastbase.tools.progress",
		"taskId":  taskID,
		"phase":   phase,
		"message": message,
	})
}

func (m *Manager) emitDone(taskID string, ok bool, message, outputPath string) {
	payload := map[string]any{
		"type":    "vastbase.tools.done",
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
