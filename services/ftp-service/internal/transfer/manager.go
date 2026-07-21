// Package transfer 实现 FTP 上传/下载任务队列（内存态，进度经事件推送与 transfer.list 查询）。
package transfer

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"niuma/services/ftp-service/internal/idgen"

	"github.com/jlaffaye/ftp"
)

const (
	copyBuffer      = 32 * 1024
	progressStep    = 256 * 1024
	progressEmitMin = 250 * time.Millisecond

	errFmtMkdirRemote  = "mkdir remote %q: %w"
	errFmtTaskNotFound = "task not found: %s"

	logMsgTransferDone     = "transfer.done"
	logMsgTransferFailed   = "transfer.failed"
	logMsgTransferCanceled = "transfer.canceled"
)

// Emitter 向 Platform 事件入口上报 JSON 事件（异步、可忽略错误）。
type Emitter func(payload map[string]any)

// Direction 传输方向。
type Direction string

const (
	DirectionUpload   Direction = "upload"
	DirectionDownload Direction = "download"
)

// State 任务状态。
type State string

const (
	StateQueued    State = "queued"
	StateRunning   State = "running"
	StatePaused    State = "paused"
	StateDone      State = "done"
	StateFailed    State = "failed"
	StateCanceled  State = "canceled"
)

// Task 是对外可见的传输任务快照。
type Task struct {
	TaskID      string    `json:"taskId"`
	SessionID   string    `json:"sessionId"`
	Direction   Direction `json:"direction"`
	LocalPath   string    `json:"localPath"`
	RemotePath  string    `json:"remotePath"`
	State       State     `json:"state"`
	Total       int64     `json:"total"`
	Transferred int64     `json:"transferred"`
	SpeedBps    int64     `json:"speedBps"`
	Error       string    `json:"error,omitempty"`
}

// EnqueueParams 入队参数。
type EnqueueParams struct {
	SessionID  string    `json:"sessionId"`
	Direction  Direction `json:"direction"`
	LocalPath  string    `json:"localPath"`
	RemotePath string    `json:"remotePath"`
	Overwrite  string    `json:"overwrite"`
}

type task struct {
	Task
	overwrite       string
	cancel          context.CancelFunc
	pauseCh         chan struct{}
	resumeCh        chan struct{}
	lastProgressEmit time.Time
}

// SessionConn 按 sessionId 获取 FTP 连接；release 在传输结束后调用。
type SessionConn func(sessionID string) (conn *ftp.ServerConn, release func(), err error)

type sessionRunner struct {
	tasks chan *task
}

// Manager 管理传输任务队列（桌面端不设全局并发上限；不同 session 并行，同 session 串行执行）。
type Manager struct {
	mu        sync.Mutex
	tasks     map[string]*task
	runners   map[string]*sessionRunner
	runnersMu sync.Mutex
	ids       idgen.Generator
	getConn   SessionConn
	emit      Emitter
}

// New 创建 Manager。
func New(ids idgen.Generator, getConn SessionConn, emit Emitter) *Manager {
	return &Manager{
		tasks:   make(map[string]*task),
		runners: make(map[string]*sessionRunner),
		ids:     ids,
		getConn: getConn,
		emit:    emit,
	}
}

// Enqueue 入队并异步执行。
func (m *Manager) Enqueue(params EnqueueParams) (string, error) {
	if params.SessionID == "" {
		return "", fmt.Errorf("sessionId required")
	}
	if params.LocalPath == "" || params.RemotePath == "" {
		return "", fmt.Errorf("localPath and remotePath required")
	}
	if params.Direction != DirectionUpload && params.Direction != DirectionDownload {
		return "", fmt.Errorf("invalid direction")
	}

	taskID, err := m.ids.NextString()
	if err != nil {
		return "", err
	}

	t := &task{
		Task: Task{
			TaskID:     taskID,
			SessionID:  params.SessionID,
			Direction:  params.Direction,
			LocalPath:  params.LocalPath,
			RemotePath: params.RemotePath,
			State:      StateQueued,
		},
		overwrite: params.Overwrite,
		pauseCh:   make(chan struct{}, 1),
		resumeCh:  make(chan struct{}, 1),
	}

	m.mu.Lock()
	m.tasks[taskID] = t
	m.mu.Unlock()

	m.emitState(t)
	m.dispatchTask(t)
	return taskID, nil
}

func (m *Manager) dispatchTask(t *task) {
	m.runnersMu.Lock()
	r, ok := m.runners[t.SessionID]
	if !ok {
		r = &sessionRunner{tasks: make(chan *task, 256)}
		m.runners[t.SessionID] = r
		go m.runSessionLoop(t.SessionID, r)
	}
	m.runnersMu.Unlock()
	r.tasks <- t
}

func (m *Manager) runSessionLoop(sessionID string, r *sessionRunner) {
	for t := range r.tasks {
		m.runTask(t)
	}
	m.runnersMu.Lock()
	if cur, ok := m.runners[sessionID]; ok && cur == r {
		delete(m.runners, sessionID)
	}
	m.runnersMu.Unlock()
}

// Pause 暂停运行中的任务。
func (m *Manager) Pause(taskID string) error {
	m.mu.Lock()
	t, ok := m.tasks[taskID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf(errFmtTaskNotFound, taskID)
	}
	if t.State != StateRunning {
		return fmt.Errorf("task not running: %s", taskID)
	}
	select {
	case t.pauseCh <- struct{}{}:
	default:
	}
	return nil
}

// Resume 恢复已暂停的任务。
func (m *Manager) Resume(taskID string) error {
	m.mu.Lock()
	t, ok := m.tasks[taskID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf(errFmtTaskNotFound, taskID)
	}
	if t.State != StatePaused {
		return fmt.Errorf("task not paused: %s", taskID)
	}
	select {
	case t.resumeCh <- struct{}{}:
	default:
	}
	return nil
}

// Cancel 取消任务。
func (m *Manager) Cancel(taskID string) error {
	m.mu.Lock()
	t, ok := m.tasks[taskID]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf(errFmtTaskNotFound, taskID)
	}
	if t.cancel != nil {
		t.cancel()
	}
	m.setState(t, StateCanceled, "")
	return nil
}

// List 返回任务列表（可选按 session 过滤）。
func (m *Manager) List(sessionID string) []Task {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Task, 0, len(m.tasks))
	for _, t := range m.tasks {
		if sessionID != "" && t.SessionID != sessionID {
			continue
		}
		out = append(out, t.snapshot())
	}
	return out
}

// CancelSession 取消某会话的全部任务。
func (m *Manager) CancelSession(sessionID string) {
	m.mu.Lock()
	var ids []string
	for id, t := range m.tasks {
		if t.SessionID == sessionID && t.State != StateDone && t.State != StateFailed && t.State != StateCanceled {
			ids = append(ids, id)
		}
	}
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.Cancel(id)
	}
}

// StopSession 取消会话任务并停止串行调度器（会话关闭时调用）。
func (m *Manager) StopSession(sessionID string) {
	m.CancelSession(sessionID)
	m.runnersMu.Lock()
	r, ok := m.runners[sessionID]
	if ok {
		delete(m.runners, sessionID)
		close(r.tasks)
	}
	m.runnersMu.Unlock()
}

func (m *Manager) runTask(t *task) {
	if t.State == StateCanceled {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	defer cancel()

	m.setState(t, StateRunning, "")

	conn, release, err := m.getConn(t.SessionID)
	if err != nil {
		m.setState(t, StateFailed, err.Error())
		logTransferFailed(t, err)
		return
	}
	defer release()

	var runErr error
	switch t.Direction {
	case DirectionDownload:
		runErr = m.download(ctx, conn, t)
	case DirectionUpload:
		runErr = m.upload(ctx, conn, t)
	}

	if ctx.Err() != nil {
		if t.State != StateCanceled {
			m.setState(t, StateCanceled, "")
			logTransferCanceled(t)
		}
		return
	}
	if runErr != nil {
		m.setState(t, StateFailed, runErr.Error())
		logTransferFailed(t, runErr)
		return
	}
	m.setState(t, StateDone, "")
	logTransferDone(t)
}

func (m *Manager) download(ctx context.Context, conn *ftp.ServerConn, t *task) error {
	local := t.LocalPath
	remote := t.RemotePath

	isDir, err := remoteIsDir(conn, remote)
	if err != nil {
		return err
	}
	if isDir {
		if err := os.MkdirAll(local, 0o755); err != nil {
			return fmt.Errorf("mkdir local: %w", err)
		}
		return m.downloadDir(ctx, conn, t)
	}

	if err := os.MkdirAll(filepath.Dir(local), 0o755); err != nil {
		return fmt.Errorf("mkdir local: %w", err)
	}

	fileTotal := int64(0)
	if size, sizeErr := conn.FileSize(remote); sizeErr == nil {
		fileTotal = size
	}
	m.setTotal(t, fileTotal)

	_, err = m.downloadFile(ctx, conn, t, remote, local, 0, fileTotal)
	return err
}

func (m *Manager) upload(ctx context.Context, conn *ftp.ServerConn, t *task) error {
	local := t.LocalPath
	remote := t.RemotePath

	info, err := os.Stat(local)
	if err != nil {
		return fmt.Errorf("stat local: %w", err)
	}
	if info.IsDir() {
		return m.uploadDir(ctx, conn, t)
	}

	fileTotal := info.Size()
	m.setTotal(t, fileTotal)
	_, err = m.uploadFile(ctx, conn, t, local, remote, 0, fileTotal)
	return err
}

func (m *Manager) copyWithProgress(ctx context.Context, t *task, src io.Reader, dst io.Writer, baseTransferred int64) error {
	buf := make([]byte, copyBuffer)
	var fileTransferred int64
	lastTick := time.Now()
	lastBytes := int64(0)
	overallTotal := atomic.LoadInt64(&t.Total)

	for {
		if err := m.waitIfResumable(ctx, t); err != nil {
			return err
		}

		n, readErr := src.Read(buf)
		if n > 0 {
			if _, wErr := dst.Write(buf[:n]); wErr != nil {
				return wErr
			}
			fileTransferred += int64(n)
			lastTick, lastBytes = m.maybeReportProgress(
				t, baseTransferred, fileTransferred, lastBytes, lastTick, overallTotal, readErr == io.EOF,
			)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	m.setProgress(t, baseTransferred+fileTransferred, overallTotal, 0)
	return nil
}

func (m *Manager) waitIfResumable(ctx context.Context, t *task) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.pauseCh:
		m.setState(t, StatePaused, "")
		select {
		case <-t.resumeCh:
			m.setState(t, StateRunning, "")
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	default:
		return nil
	}
}

func (m *Manager) maybeReportProgress(
	t *task,
	baseTransferred, fileTransferred, lastBytes int64,
	lastTick time.Time,
	overallTotal int64,
	force bool,
) (time.Time, int64) {
	if fileTransferred-lastBytes < progressStep && !force {
		return lastTick, lastBytes
	}
	transferred := baseTransferred + fileTransferred
	now := time.Now()
	elapsed := now.Sub(lastTick).Seconds()
	speed := int64(0)
	if elapsed > 0 {
		speed = int64(float64(fileTransferred-lastBytes) / elapsed)
	}
	m.setProgress(t, transferred, overallTotal, speed)
	return now, fileTransferred
}

func (t *task) snapshot() Task {
	return Task{
		TaskID:      t.TaskID,
		SessionID:   t.SessionID,
		Direction:   t.Direction,
		LocalPath:   t.LocalPath,
		RemotePath:  t.RemotePath,
		State:       t.State,
		Total:       atomic.LoadInt64(&t.Total),
		Transferred: atomic.LoadInt64(&t.Transferred),
		SpeedBps:    atomic.LoadInt64(&t.SpeedBps),
		Error:       t.Error,
	}
}

func (m *Manager) setState(t *task, state State, errMsg string) {
	m.mu.Lock()
	t.State = state
	t.Error = errMsg
	m.mu.Unlock()
	m.emitState(t)
}

func (m *Manager) setTotal(t *task, total int64) {
	atomic.StoreInt64(&t.Total, total)
}

func (m *Manager) setProgress(t *task, transferred, total, speed int64) {
	atomic.StoreInt64(&t.Transferred, transferred)
	if total > 0 {
		atomic.StoreInt64(&t.Total, total)
	}
	if speed > 0 {
		atomic.StoreInt64(&t.SpeedBps, speed)
	}
	m.emitProgress(t)
}

func (m *Manager) emitState(t *task) {
	if m.emit == nil {
		return
	}
	ev := map[string]any{
		"type":      "ftp.transfer.state",
		"taskId":    t.TaskID,
		"sessionId": t.SessionID,
		"state":     t.State,
	}
	if t.Error != "" {
		ev["error"] = t.Error
	}
	m.fireEvent(ev)
}

func (m *Manager) emitProgress(t *task) {
	if m.emit == nil {
		return
	}
	now := time.Now()
	if !t.lastProgressEmit.IsZero() && now.Sub(t.lastProgressEmit) < progressEmitMin {
		return
	}
	t.lastProgressEmit = now
	m.fireEvent(map[string]any{
		"type":        "ftp.transfer.progress",
		"taskId":      t.TaskID,
		"sessionId":   t.SessionID,
		"transferred": atomic.LoadInt64(&t.Transferred),
		"total":       atomic.LoadInt64(&t.Total),
		"speedBps":    atomic.LoadInt64(&t.SpeedBps),
	})
}

func (m *Manager) fireEvent(ev map[string]any) {
	if m.emit != nil {
		m.emit(ev)
	}
}

func transferLogAttrs(t *task) []any {
	return []any{
		"task", t.TaskID,
		"session", t.SessionID,
		"dir", t.Direction,
		"local", t.LocalPath,
		"remote", t.RemotePath,
	}
}

func logTransferDone(t *task) {
	attrs := transferLogAttrs(t)
	attrs = append(attrs, "bytes", atomic.LoadInt64(&t.Transferred))
	slog.Info(logMsgTransferDone, attrs...)
}

func logTransferFailed(t *task, err error) {
	attrs := transferLogAttrs(t)
	attrs = append(attrs, "err", err)
	slog.Error(logMsgTransferFailed, attrs...)
}

func logTransferCanceled(t *task) {
	slog.Info(logMsgTransferCanceled, transferLogAttrs(t)...)
}
