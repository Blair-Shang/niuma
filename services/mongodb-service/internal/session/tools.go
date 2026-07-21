package session

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

	"niuma/services/mongodb-service/internal/idgen"
)

// ToolsEmitter 上报工具任务事件。
type ToolsEmitter func(payload map[string]any)

// ToolTaskState 任务阶段。
type ToolTaskState string

const (
	ToolTaskQueued  ToolTaskState = "queued"
	ToolTaskRunning ToolTaskState = "running"
	ToolTaskDone    ToolTaskState = "done"
	ToolTaskFailed  ToolTaskState = "failed"
	ToolTaskCanceled ToolTaskState = "canceled"
)

// ToolsDetectResult 是 tools.detect 返回结构。
type ToolsDetectResult struct {
	Mongodump    ToolDetectResult `json:"mongodump"`
	Mongorestore ToolDetectResult `json:"mongorestore"`
	Mongoexport  ToolDetectResult `json:"mongoexport"`
	Mongoimport  ToolDetectResult `json:"mongoimport"`
}

// ToolsManager 管理 mongo-tools 子进程任务。
type ToolsManager struct {
	mu       sync.Mutex
	tasks    map[string]*toolTask
	sessions *Manager
	ids      idgen.Generator
	emit     ToolsEmitter
}

type toolTask struct {
	taskID    string
	sessionID string
	cancel    context.CancelFunc
}

// NewToolsManager 创建工具任务管理器。
func NewToolsManager(sessions *Manager, ids idgen.Generator, emit ToolsEmitter) *ToolsManager {
	return &ToolsManager{
		tasks:    make(map[string]*toolTask),
		sessions: sessions,
		ids:      ids,
		emit:     emit,
	}
}

// Detect 探测全部 mongo-tools。
func (m *ToolsManager) Detect(connPaths, requestPaths ToolPathOverrides) ToolsDetectResult {
	return ToolsDetectResult{
		Mongodump:    DetectTool("mongodump", connPaths, requestPaths),
		Mongorestore: DetectTool("mongorestore", connPaths, requestPaths),
		Mongoexport:  DetectTool("mongoexport", connPaths, requestPaths),
		Mongoimport:  DetectTool("mongoimport", connPaths, requestPaths),
	}
}

// Dump 异步执行 mongodump。
func (m *ToolsManager) Dump(ctx context.Context, sessionID, database, outputDir string, options map[string]any, requestPaths ToolPathOverrides) (string, error) {
	exe, sess, err := m.resolve("mongodump", sessionID, requestPaths)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(outputDir) == "" {
		outputDir, err = os.MkdirTemp("", "niuma-mongodump-")
		if err != nil {
			return "", err
		}
	}
	uri, env, err := CLIToolURI(sess.Params)
	if err != nil {
		return "", err
	}
	slog.Info("tools.dump.auth",
		"session", sessionID,
		"hasUser", strings.TrimSpace(sess.Params.LoginAccount) != "",
		"hasSecret", strings.TrimSpace(sess.Params.Secret) != "",
		"authDatabase", strings.TrimSpace(sess.Params.Options.AuthDatabase),
	)
	args := MongodumpArgs(uri, database, outputDir, options)
	return m.start(ctx, sessionID, exe, args, env, outputDir)
}

// Restore 异步执行 mongorestore。
func (m *ToolsManager) Restore(ctx context.Context, sessionID, inputDir string, options map[string]any, requestPaths ToolPathOverrides) (string, error) {
	exe, sess, err := m.resolve("mongorestore", sessionID, requestPaths)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(inputDir) == "" {
		return "", fmt.Errorf("inputDir required")
	}
	uri, env, err := CLIToolURI(sess.Params)
	if err != nil {
		return "", err
	}
	args := MongorestoreArgs(uri, inputDir, options)
	return m.start(ctx, sessionID, exe, args, env, inputDir)
}

// Export 异步执行 mongoexport。
func (m *ToolsManager) Export(ctx context.Context, sessionID, database, collection, format, outputPath string, requestPaths ToolPathOverrides) (string, error) {
	exe, sess, err := m.resolve("mongoexport", sessionID, requestPaths)
	if err != nil {
		return "", err
	}
	if database == "" || collection == "" {
		return "", fmt.Errorf("database and collection required")
	}
	if strings.TrimSpace(outputPath) == "" {
		outputPath, err = m.tempOutput("export", format)
		if err != nil {
			return "", err
		}
	}
	uri, env, err := CLIToolURI(sess.Params)
	if err != nil {
		return "", err
	}
	slog.Info("tools.export.auth",
		"session", sessionID,
		"hasUser", strings.TrimSpace(sess.Params.LoginAccount) != "",
		"hasSecret", strings.TrimSpace(sess.Params.Secret) != "",
		"authDatabase", strings.TrimSpace(sess.Params.Options.AuthDatabase),
	)
	args := MongoexportArgs(uri, database, collection, format, outputPath)
	return m.start(ctx, sessionID, exe, args, env, outputPath)
}

// Import 异步执行 mongoimport。
func (m *ToolsManager) Import(ctx context.Context, sessionID, database, collection, format, inputPath string, requestPaths ToolPathOverrides) (string, error) {
	exe, sess, err := m.resolve("mongoimport", sessionID, requestPaths)
	if err != nil {
		return "", err
	}
	if database == "" || collection == "" || strings.TrimSpace(inputPath) == "" {
		return "", fmt.Errorf("database, collection and inputPath required")
	}
	uri, env, err := CLIToolURI(sess.Params)
	if err != nil {
		return "", err
	}
	args := MongoimportArgs(uri, database, collection, format, inputPath)
	return m.start(ctx, sessionID, exe, args, env, "")
}

// Cancel 取消任务（通过 context 终止子进程，由 run 统一上报 done）。
func (m *ToolsManager) Cancel(taskID string) error {
	m.mu.Lock()
	t, ok := m.tasks[taskID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("task not found: %s", taskID)
	}
	if t.cancel != nil {
		t.cancel()
	}
	return nil
}

// CancelBySession 取消会话下全部任务。
func (m *ToolsManager) CancelBySession(sessionID string) {
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

func (m *ToolsManager) resolve(toolID, sessionID string, requestPaths ToolPathOverrides) (string, *Session, error) {
	if sessionID == "" {
		return "", nil, fmt.Errorf("sessionId required")
	}
	sess, err := m.sessions.Get(sessionID)
	if err != nil {
		return "", nil, err
	}
	exe, ok := ResolveToolPath(toolID, sess.Params.Options.ToolPaths, requestPaths)
	if !ok {
		return "", nil, fmt.Errorf("%s not found: configure path in Settings → Tool Components", toolID)
	}
	return exe, sess, nil
}

func (m *ToolsManager) start(parent context.Context, sessionID, exe string, args, env []string, outputPath string) (string, error) {
	taskID, err := m.ids.NextString()
	if err != nil {
		return "", err
	}
	runCtx, cancel := context.WithCancel(parent)
	cmd := exec.CommandContext(runCtx, exe, args...)
	cmd.Env = env

	t := &toolTask{taskID: taskID, sessionID: sessionID, cancel: cancel}
	m.mu.Lock()
	m.tasks[taskID] = t
	m.mu.Unlock()

	m.emitProgress(taskID, ToolTaskQueued, 0, "queued")
	go m.run(runCtx, taskID, cmd, outputPath)
	return taskID, nil
}

func (m *ToolsManager) run(ctx context.Context, taskID string, cmd *exec.Cmd, outputPath string) {
	defer func() {
		m.mu.Lock()
		delete(m.tasks, taskID)
		m.mu.Unlock()
	}()

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.logTaskDone(taskID, false, err.Error())
		m.emitDone(taskID, false, err.Error(), "")
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		m.logTaskDone(taskID, false, err.Error())
		m.emitDone(taskID, false, err.Error(), "")
		return
	}

	m.emitProgress(taskID, ToolTaskRunning, 0, "running")
	if err := cmd.Start(); err != nil {
		m.logTaskDone(taskID, false, err.Error())
		m.emitDone(taskID, false, err.Error(), "")
		return
	}

	var lastErrLine string
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); m.scanLines(taskID, stdout) }()
	go func() {
		defer wg.Done()
		lastErrLine = m.scanLines(taskID, stderr)
	}()
	wg.Wait()

	err = cmd.Wait()
	select {
	case <-ctx.Done():
		m.logTaskDone(taskID, false, "canceled")
		m.emitDone(taskID, false, "canceled", outputPath)
		return
	default:
	}
	if err != nil {
		msg := lastErrLine
		if msg == "" {
			msg = sanitizeToolError(err)
		} else {
			msg = sanitizeToolError(fmt.Errorf("%s", msg))
		}
		m.logTaskDone(taskID, false, msg)
		m.emitDone(taskID, false, msg, outputPath)
		return
	}
	m.logTaskDone(taskID, true, "completed")
	m.emitDone(taskID, true, "completed", outputPath)
}

func (m *ToolsManager) scanLines(taskID string, r io.Reader) string {
	last := ""
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		last = sanitizeToolMessage(line)
		m.emitProgress(taskID, ToolTaskRunning, 0, last)
	}
	return last
}

func (m *ToolsManager) tempOutput(prefix, format string) (string, error) {
	ext := ".json"
	if strings.EqualFold(format, "csv") {
		ext = ".csv"
	}
	f, err := os.CreateTemp("", "niuma-mongo-"+prefix+"-*"+ext)
	if err != nil {
		return "", err
	}
	name := f.Name()
	_ = f.Close()
	return name, nil
}

func sanitizeToolError(err error) string {
	return sanitizeToolMessage(err.Error())
}

// sanitizeToolMessage 脱敏工具 stderr / 错误中的连接串与 userinfo。
func sanitizeToolMessage(msg string) string {
	msg = redactURI(msg, "mongodb://")
	msg = redactURI(msg, "mongodb+srv://")
	return msg
}

func redactURI(msg, scheme string) string {
	var b strings.Builder
	for {
		idx := strings.Index(msg, scheme)
		if idx < 0 {
			b.WriteString(msg)
			return b.String()
		}
		b.WriteString(msg[:idx])
		b.WriteString(scheme)
		b.WriteString("...")
		rest := msg[idx+len(scheme):]
		end := len(rest)
		for i, r := range rest {
			if r == ' ' || r == '\t' || r == '"' || r == '\'' {
				end = i
				break
			}
		}
		msg = rest[end:]
	}
}

func (m *ToolsManager) emitProgress(taskID string, phase ToolTaskState, percent int, message string) {
	m.emitEvent(map[string]any{
		"type":    "mongodb.tools.progress",
		"taskId":  taskID,
		"phase":   string(phase),
		"percent": percent,
		"message": message,
	})
}

func (m *ToolsManager) emitDone(taskID string, ok bool, message, outputPath string) {
	payload := map[string]any{
		"type":    "mongodb.tools.done",
		"taskId":  taskID,
		"ok":      ok,
		"message": message,
	}
	if outputPath != "" {
		payload["outputPath"] = filepath.Clean(outputPath)
	}
	m.emitEvent(payload)
}

func (m *ToolsManager) emitEvent(payload map[string]any) {
	if m.emit != nil {
		m.emit(payload)
	}
}

func (m *ToolsManager) logTaskDone(taskID string, ok bool, message string) {
	m.mu.Lock()
	t, found := m.tasks[taskID]
	sessionID := ""
	if found {
		sessionID = t.sessionID
	}
	m.mu.Unlock()

	attrs := []any{"task", taskID}
	if sessionID != "" {
		attrs = append(attrs, "session", sessionID)
	}
	attrs = append(attrs, "ok", ok, "message", message)
	if ok {
		slog.Info("tools.task.done", attrs...)
	} else {
		slog.Error("tools.task.done", attrs...)
	}
}
