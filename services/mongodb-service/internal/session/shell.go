package session

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"

	"niuma/services/mongodb-service/internal/idgen"
)

// ShellState 是 PTY 生命周期状态。
type ShellState string

const (
	ShellStateOpening   ShellState = "opening"
	ShellStateConnected ShellState = "connected"
	ShellStateClosed    ShellState = "closed"
)

// ShellEmitter 上报 Shell 事件。
type ShellEmitter func(payload map[string]any)

// ShellManager 管理 mongosh PTY 会话（每 MongoDB 会话最多 1 个）。
type ShellManager struct {
	mu       sync.Mutex
	shells   map[string]*shellEntry
	bySess   map[string]string
	sessions *Manager
	ids      idgen.Generator
	emit     ShellEmitter
}

type shellEntry struct {
	shellID   string
	sessionID string
	cmd       *exec.Cmd
	pty       *os.File
	cancel    context.CancelFunc
}

// NewShellManager 创建 Shell 管理器。
func NewShellManager(sessions *Manager, ids idgen.Generator, emit ShellEmitter) *ShellManager {
	return &ShellManager{
		shells:   make(map[string]*shellEntry),
		bySess:   make(map[string]string),
		sessions: sessions,
		ids:      ids,
		emit:     emit,
	}
}

// Detect 探测 mongosh 是否可用。
func (m *ShellManager) Detect(connPaths, requestPaths ToolPathOverrides) ToolDetectResult {
	return DetectTool("mongosh", connPaths, requestPaths)
}

// Open 为会话启动 mongosh PTY。
func (m *ShellManager) Open(ctx context.Context, sessionID string, cols, rows uint16, requestPaths ToolPathOverrides) (string, error) {
	if sessionID == "" {
		return "", fmt.Errorf("sessionId required")
	}
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}

	sess, err := m.sessions.Get(sessionID)
	if err != nil {
		return "", err
	}

	m.mu.Lock()
	if existing, ok := m.bySess[sessionID]; ok {
		m.mu.Unlock()
		_ = m.Close(existing)
		m.mu.Lock()
	}
	m.mu.Unlock()

	exe, ok := ResolveToolPath("mongosh", sess.Params.Options.ToolPaths, requestPaths)
	if !ok {
		return "", fmt.Errorf("mongosh not found: configure path in Settings → Tool Components")
	}

	uri, env, err := CLIEnv(sess.Params, sess.ActiveDatabase())
	if err != nil {
		return "", err
	}

	shellID, err := m.ids.NextString()
	if err != nil {
		return "", err
	}

	runCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(runCtx, exe, MongoshArgs(uri)...)
	cmd.Env = env

	ptyFile, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		cancel()
		return "", fmt.Errorf("mongosh: start pty: %w", err)
	}

	entry := &shellEntry{
		shellID:   shellID,
		sessionID: sessionID,
		cmd:       cmd,
		pty:       ptyFile,
		cancel:    cancel,
	}

	m.mu.Lock()
	m.shells[shellID] = entry
	m.bySess[sessionID] = shellID
	m.mu.Unlock()

	m.emitState(shellID, ShellStateOpening)
	m.emitState(shellID, ShellStateConnected)
	go m.readLoop(shellID, ptyFile, runCtx)
	go m.waitExit(shellID, cmd, runCtx)

	return shellID, nil
}

// Input 向 PTY 写入输入。
func (m *ShellManager) Input(shellID, data string) error {
	entry, err := m.get(shellID)
	if err != nil {
		return err
	}
	if data == "" {
		return nil
	}
	_, err = entry.pty.Write([]byte(data))
	return err
}

// Resize 调整 PTY 尺寸。
func (m *ShellManager) Resize(shellID string, cols, rows uint16) error {
	entry, err := m.get(shellID)
	if err != nil {
		return err
	}
	if cols == 0 || rows == 0 {
		return fmt.Errorf("cols and rows required")
	}
	return pty.Setsize(entry.pty, &pty.Winsize{Cols: cols, Rows: rows})
}

// Close 关闭指定 Shell。
func (m *ShellManager) Close(shellID string) error {
	m.mu.Lock()
	entry, ok := m.shells[shellID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("shell not found: %s", shellID)
	}
	delete(m.shells, shellID)
	delete(m.bySess, entry.sessionID)
	m.mu.Unlock()

	entry.cancel()
	if entry.pty != nil {
		_ = entry.pty.Close()
	}
	if entry.cmd != nil && entry.cmd.Process != nil {
		_ = entry.cmd.Process.Kill()
	}
	m.emitState(shellID, ShellStateClosed)
	return nil
}

// CloseBySession 关闭会话关联的 Shell。
func (m *ShellManager) CloseBySession(sessionID string) {
	m.mu.Lock()
	shellID, ok := m.bySess[sessionID]
	m.mu.Unlock()
	if ok {
		_ = m.Close(shellID)
	}
}

func (m *ShellManager) get(shellID string) (*shellEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, ok := m.shells[shellID]
	if !ok {
		return nil, fmt.Errorf("shell not found: %s", shellID)
	}
	return entry, nil
}

func (m *ShellManager) readLoop(shellID string, r io.Reader, ctx context.Context) {
	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		n, err := r.Read(buf)
		if n > 0 {
			m.emitEvent(map[string]any{
				"type":    "mongodb.shell.output",
				"shellId": shellID,
				"data":    string(buf[:n]),
			})
		}
		if err != nil {
			return
		}
	}
}

func (m *ShellManager) waitExit(shellID string, cmd *exec.Cmd, ctx context.Context) {
	_ = cmd.Wait()
	select {
	case <-ctx.Done():
	default:
		m.mu.Lock()
		_, tracked := m.shells[shellID]
		m.mu.Unlock()
		if tracked {
			_ = m.Close(shellID)
		}
	}
}

func (m *ShellManager) emitState(shellID string, state ShellState) {
	m.emitEvent(map[string]any{
		"type":    "mongodb.shell.state",
		"shellId": shellID,
		"state":   string(state),
	})
}

func (m *ShellManager) emitEvent(payload map[string]any) {
	if m.emit != nil {
		m.emit(payload)
	}
}
