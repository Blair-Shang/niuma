// Package handler 实现 ftp-service 的 IPC 方法分发与会话管理。
package handler

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"path"
	"strings"
	"sync"
	"time"

	"niuma/pkg/tunnel"
	"niuma/services/ftp-service/internal/eventpub"
	"niuma/services/ftp-service/internal/idgen"
	"niuma/services/ftp-service/internal/transfer"

	"github.com/jlaffaye/ftp"
)

// TLS 模式常量，与前端 FtpConnectionOptions.tls_mode 对齐。
const (
	tlsModeNone     = "none"
	tlsModeExplicit = "explicit"
	tlsModeImplicit = "implicit"
)

// 编码与传输类型常量，与前端 FtpConnectionOptions 对齐。
const (
	encodingGBK       = "gbk"
	transferTypeASCII = "ascii"
)

// 默认端口：Implicit FTPS 使用 990，其余使用 21。
const (
	defaultFTPPort      = 21
	defaultFTPSImplPort = 990
)

// 能力服务内部方法名（platform-core 代理时映射为 ftp.* 命名空间）。
const (
	MethodSessionOpen     = "session.open"
	MethodSessionClose    = "session.close"
	MethodSessionTest     = "session.test"
	MethodDirList         = "dir.list"
	MethodDirMake         = "dir.make"
	MethodEntryDelete     = "entry.delete"
	MethodEntryRename     = "entry.rename"
	MethodTransferEnqueue = "transfer.enqueue"
	MethodTransferCancel  = "transfer.cancel"
	MethodTransferPause   = "transfer.pause"
	MethodTransferResume  = "transfer.resume"
	MethodTransferList    = "transfer.list"
	MethodFileRead        = "file.read"
	MethodFileWrite       = "file.write"
)

// maxFileReadSize 是在线读取文件内容的最大字节数（10 MB）。
const maxFileReadSize = 10 * 1024 * 1024

const defaultDialTimeout = 30 * time.Second

const (
	errInvalidParamsFmt       = "invalid params: %v"
	errSessionIDRequired      = "sessionId required"
	errSessionIDPathRequired  = "sessionId and path required"
	errTaskIDRequired         = "taskId required"
	errSessionBusy            = "ftp: session busy: transfer in progress"
)

type Request struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	ID     string          `json:"id"`
}

type Response struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Result string `json:"result"`
}

// ConnectOptions 与 Web connection_options JSON 对齐。
type ConnectOptions struct {
	Protocol             string          `json:"protocol"`
	TLSMode              string          `json:"tls_mode"`
	Passive              bool            `json:"passive"`
	Encoding             string          `json:"encoding"`
	TransferType         string          `json:"transfer_type"`
	TLSVerify            bool            `json:"tls_verify"`
	TimeoutSeconds       int             `json:"timeout_seconds"`
	TimeoutSecondsLegacy int             `json:"timeoutSeconds"`
	KeepaliveSeconds     int             `json:"keepalive_seconds"`
	Anonymous            bool            `json:"anonymous"`
	Proxy                *ProxyOptions   `json:"proxy,omitempty"`
	// SSH 跳板机隧道；platform 在转发前已注入 sshProfile 凭据。
	Tunnel               *tunnel.Options `json:"tunnel,omitempty"`
}

// effectiveTimeoutSeconds 返回建连超时秒数；兼容历史 camelCase 字段。
func (o ConnectOptions) effectiveTimeoutSeconds() int {
	if o.TimeoutSeconds > 0 {
		return o.TimeoutSeconds
	}
	if o.TimeoutSecondsLegacy > 0 {
		return o.TimeoutSecondsLegacy
	}
	return 0
}

// ConnectParams 是建连参数（含明文凭据，仅进程内使用）。
//
// Secret 承载用户认证凭据（密码或私钥内容）；新信封字段名为 `secret`。
// 历史字段 `password` 由 JSON 反序列化时自动回退（通过 UnmarshalJSON 兼容）。
type ConnectParams struct {
	HostAddress  string         `json:"hostAddress"`
	PortNumber   int            `json:"portNumber"`
	LoginAccount string         `json:"loginAccount"`
	Secret       string         `json:"secret"`
	Options      ConnectOptions `json:"options"`
}

// UnmarshalJSON 兼容历史 `password` 字段（platform 旧版仍可能发送 password）。
func (p *ConnectParams) UnmarshalJSON(data []byte) error {
	type alias ConnectParams
	var raw struct {
		alias
		Password string `json:"password"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*p = ConnectParams(raw.alias)
	if p.Secret == "" && raw.Password != "" {
		p.Secret = raw.Password
	}
	return nil
}

type sessionOpenParams struct {
	ConnectParams
}

type sessionIDParams struct {
	SessionID string `json:"sessionId"`
}

type dirListParams struct {
	SessionID string `json:"sessionId"`
	Path      string `json:"path"`
}

type dirMakeParams struct {
	SessionID string `json:"sessionId"`
	Path      string `json:"path"`
}

type entryDeleteParams struct {
	SessionID string `json:"sessionId"`
	Path      string `json:"path"`
	Kind      string `json:"kind"`
	Recursive bool   `json:"recursive"`
}

type entryRenameParams struct {
	SessionID string `json:"sessionId"`
	FromPath  string `json:"fromPath"`
	ToPath    string `json:"toPath"`
}

type fileReadParams struct {
	SessionID string `json:"sessionId"`
	Path      string `json:"path"`
}

type fileWriteParams struct {
	SessionID string `json:"sessionId"`
	Path      string `json:"path"`
	Content   string `json:"content"`
}

type FtpEntry struct {
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Size        int64  `json:"size"`
	ModifiedAt  string `json:"modifiedAt"`
	Permissions string `json:"permissions"`
}

type session struct {
	id            string
	conn          *ftp.ServerConn
	mu            sync.Mutex
	tunnelStop    func() // non-nil when a SSH tunnel is active; call to tear down forwarding
	keepaliveStop chan struct{}
}

// Dispatcher 管理 FTP 会话并处理方法。
type Dispatcher struct {
	mu       sync.Mutex
	sessions map[string]*session
	ids      idgen.Generator
	xfers    *transfer.Manager
}

// New 创建 Dispatcher。
func New(ids idgen.Generator) *Dispatcher {
	d := &Dispatcher{
		sessions: make(map[string]*session),
		ids:      ids,
	}
	pub := eventpub.New()
	d.xfers = transfer.New(ids, d.acquireConn, pub.Emit)
	return d
}

// HandleFrame 解析请求并返回响应 JSON 字节。
func (d *Dispatcher) HandleFrame(ctx context.Context, raw []byte) []byte {
	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return marshalResponse(Response{
			OK:    false,
			Error: fmt.Sprintf("invalid request json: %v", err),
		})
	}
	return marshalResponse(d.dispatch(ctx, req))
}

func (d *Dispatcher) dispatch(ctx context.Context, req Request) Response {
	switch req.Method {
	case MethodSessionOpen:
		return d.sessionOpen(ctx, req)
	case MethodSessionClose:
		return d.sessionClose(ctx, req)
	case MethodSessionTest:
		return d.sessionTest(ctx, req)
	case MethodDirList:
		return d.dirList(ctx, req)
	case MethodDirMake:
		return d.dirMake(ctx, req)
	case MethodEntryDelete:
		return d.entryDelete(ctx, req)
	case MethodEntryRename:
		return d.entryRename(ctx, req)
	case MethodTransferEnqueue:
		return d.transferEnqueue(ctx, req)
	case MethodTransferCancel:
		return d.transferCancel(ctx, req)
	case MethodTransferPause:
		return d.transferPause(ctx, req)
	case MethodTransferResume:
		return d.transferResume(ctx, req)
	case MethodTransferList:
		return d.transferList(ctx, req)
	case MethodFileRead:
		return d.fileRead(ctx, req)
	case MethodFileWrite:
		return d.fileWrite(ctx, req)
	default:
		return errorResponse(req.ID, "method not found: "+req.Method)
	}
}

func (d *Dispatcher) sessionOpen(ctx context.Context, req Request) Response {
	var params sessionOpenParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	conn, tunnelStop, err := dialFTPWithTunnel(ctx, params.ConnectParams)
	if err != nil {
		slog.Error(MethodSessionOpen, "host", params.HostAddress, "port", params.PortNumber, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	sessionID, err := d.ids.NextString()
	if err != nil {
		_ = conn.Quit()
		if tunnelStop != nil {
			tunnelStop()
		}
		return errorResponse(req.ID, err.Error())
	}
	sess := &session{id: sessionID, conn: conn, tunnelStop: tunnelStop}
	keepaliveSecs := params.Options.effectiveKeepaliveSeconds()
	if keepaliveSecs <= 0 {
		keepaliveSecs = defaultKeepaliveSeconds
	}
	startSessionKeepalive(sess, keepaliveSecs)
	d.mu.Lock()
	d.sessions[sessionID] = sess
	d.mu.Unlock()
	slog.Info(MethodSessionOpen, "session", sessionID, "host", params.HostAddress, "port", params.PortNumber)
	return okResponse(req.ID, map[string]any{"sessionId": sessionID})
}

func (d *Dispatcher) sessionClose(_ context.Context, req Request) Response {
	var params sessionIDParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	if err := d.closeSession(params.SessionID); err != nil {
		slog.Error(MethodSessionClose, "session", params.SessionID, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	slog.Info(MethodSessionClose, "session", params.SessionID)
	return okResponse(req.ID, map[string]any{"closed": true})
}

func (d *Dispatcher) sessionTest(ctx context.Context, req Request) Response {
	var params ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	conn, tunnelStop, err := dialFTPWithTunnel(ctx, params)
	if err != nil {
		slog.Warn(MethodSessionTest, "host", params.HostAddress, "port", params.PortNumber, "ok", false, "err", err)
		return okResponse(req.ID, map[string]any{"ok": false, "message": err.Error()})
	}
	_ = conn.Quit()
	if tunnelStop != nil {
		tunnelStop()
	}
	slog.Info(MethodSessionTest, "host", params.HostAddress, "port", params.PortNumber, "ok", true)
	return okResponse(req.ID, map[string]any{"ok": true, "message": "connected"})
}

func (d *Dispatcher) dirList(_ context.Context, req Request) Response {
	var params dirListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	path := normalizeRemotePath(params.Path)
	var entries []*ftp.Entry
	err := d.withSessionTryLock(params.SessionID, func(conn *ftp.ServerConn) error {
		var listErr error
		entries, listErr = conn.List(path)
		return listErr
	})
	if err != nil {
		if err.Error() == errSessionBusy {
			slog.Warn(MethodDirList, "session", params.SessionID, "path", path, "reason", "busy")
		} else {
			slog.Error(MethodDirList, "session", params.SessionID, "path", path, "err", err)
		}
		return errorResponse(req.ID, fmt.Sprintf("ftp: list %q: %v", path, err))
	}
	out := make([]FtpEntry, 0, len(entries))
	for _, ent := range entries {
		out = append(out, toFtpEntry(ent))
	}
	slog.Info(MethodDirList, "session", params.SessionID, "path", path, "entries", len(out))
	return okResponse(req.ID, map[string]any{"path": path, "entries": out})
}

func (d *Dispatcher) dirMake(_ context.Context, req Request) Response {
	var params dirMakeParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" {
		return errorResponse(req.ID, errSessionIDRequired)
	}
	path := normalizeRemotePath(params.Path)
	err := d.withSessionTryLock(params.SessionID, func(conn *ftp.ServerConn) error {
		return conn.MakeDir(path)
	})
	if err != nil {
		if err.Error() == errSessionBusy {
			slog.Warn(MethodDirMake, "session", params.SessionID, "path", path, "reason", "busy")
		} else {
			slog.Error(MethodDirMake, "session", params.SessionID, "path", path, "err", err)
		}
		return errorResponse(req.ID, fmt.Sprintf("ftp: mkdir %q: %v", path, err))
	}
	slog.Info(MethodDirMake, "session", params.SessionID, "path", path)
	return okResponse(req.ID, map[string]any{"created": true})
}

func (d *Dispatcher) entryDelete(_ context.Context, req Request) Response {
	var params entryDeleteParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		slog.Warn(MethodEntryDelete, "result", "rejected", "reason", "invalid params", "err", err)
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" || params.Path == "" {
		slog.Warn(MethodEntryDelete, "result", "rejected", "reason", "missing sessionId or path")
		return errorResponse(req.ID, errSessionIDPathRequired)
	}
	targetPath := normalizeRemotePath(params.Path)
	kind := params.Kind
	if kind == "" {
		kind = "file"
	}
	var cwd string
	err := d.withSessionTryLock(params.SessionID, func(conn *ftp.ServerConn) error {
		var opErr error
		if kind == "dir" {
			if params.Recursive {
				opErr = removeRemoteDirRecursiveSafe(conn, targetPath)
			} else {
				leaveDeleteTargetIfInside(conn, targetPath)
				opErr = conn.RemoveDir(targetPath)
			}
		} else {
			opErr = conn.Delete(targetPath)
		}
		if opErr != nil {
			cwd, _ = conn.CurrentDir()
		}
		return opErr
	})
	if err != nil {
		if err.Error() == errSessionBusy {
			slog.Warn(MethodEntryDelete, "session", params.SessionID, "path", targetPath, "reason", "busy")
		} else {
			slog.Error(MethodEntryDelete,
				"session", params.SessionID,
				"path", targetPath,
				"kind", kind,
				"recursive", params.Recursive,
				"cwd", normalizeRemotePath(cwd),
				"result", "failed",
				"err", err,
			)
		}
		return errorResponse(req.ID, fmt.Sprintf("ftp: delete %q: %v", targetPath, err))
	}
	slog.Info(MethodEntryDelete,
		"session", params.SessionID,
		"path", targetPath,
		"kind", kind,
		"recursive", params.Recursive,
		"result", "ok",
	)
	return okResponse(req.ID, map[string]any{"deleted": true})
}

func (d *Dispatcher) entryRename(_ context.Context, req Request) Response {
	var params entryRenameParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" || params.FromPath == "" || params.ToPath == "" {
		return errorResponse(req.ID, "sessionId, fromPath and toPath required")
	}
	fromPath := normalizeRemotePath(params.FromPath)
	toPath := normalizeRemotePath(params.ToPath)
	err := d.withSessionTryLock(params.SessionID, func(conn *ftp.ServerConn) error {
		return conn.Rename(fromPath, toPath)
	})
	if err != nil {
		if err.Error() == errSessionBusy {
			slog.Warn(MethodEntryRename, "session", params.SessionID, "from", fromPath, "to", toPath, "reason", "busy")
		} else {
			slog.Error(MethodEntryRename, "session", params.SessionID, "from", fromPath, "to", toPath, "err", err)
		}
		return errorResponse(req.ID, fmt.Sprintf("ftp: rename %q -> %q: %v", fromPath, toPath, err))
	}
	slog.Info(MethodEntryRename, "session", params.SessionID, "from", fromPath, "to", toPath)
	return okResponse(req.ID, map[string]any{"renamed": true})
}

func (d *Dispatcher) acquireConn(sessionID string) (*ftp.ServerConn, func(), error) {
	s, err := d.getSession(sessionID)
	if err != nil {
		return nil, nil, err
	}
	s.mu.Lock()
	return s.conn, func() { s.mu.Unlock() }, nil
}

func (d *Dispatcher) withSessionTryLock(sessionID string, fn func(*ftp.ServerConn) error) error {
	s, err := d.getSession(sessionID)
	if err != nil {
		return err
	}
	if !s.mu.TryLock() {
		return fmt.Errorf("%s", errSessionBusy)
	}
	defer s.mu.Unlock()
	return fn(s.conn)
}

type transferEnqueueParams struct {
	SessionID  string `json:"sessionId"`
	Direction  string `json:"direction"`
	LocalPath  string `json:"localPath"`
	RemotePath string `json:"remotePath"`
	Overwrite  string `json:"overwrite"`
}

type transferCancelParams struct {
	TaskID string `json:"taskId"`
}

type transferListParams struct {
	SessionID string `json:"sessionId"`
}

func (d *Dispatcher) transferEnqueue(_ context.Context, req Request) Response {
	var params transferEnqueueParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	taskID, err := d.xfers.Enqueue(transfer.EnqueueParams{
		SessionID:  params.SessionID,
		Direction:  transfer.Direction(params.Direction),
		LocalPath:  params.LocalPath,
		RemotePath: params.RemotePath,
		Overwrite:  params.Overwrite,
	})
	if err != nil {
		slog.Error(MethodTransferEnqueue,
			"session", params.SessionID, "dir", params.Direction,
			"local", params.LocalPath, "remote", params.RemotePath, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	slog.Info(MethodTransferEnqueue,
		"task", taskID, "session", params.SessionID, "dir", params.Direction,
		"local", params.LocalPath, "remote", params.RemotePath)
	return okResponse(req.ID, map[string]any{"taskId": taskID})
}

func (d *Dispatcher) transferCancel(_ context.Context, req Request) Response {
	var params transferCancelParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.TaskID == "" {
		return errorResponse(req.ID, errTaskIDRequired)
	}
	if err := d.xfers.Cancel(params.TaskID); err != nil {
		slog.Error(MethodTransferCancel, "task", params.TaskID, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	slog.Info(MethodTransferCancel, "task", params.TaskID)
	return okResponse(req.ID, map[string]any{"ok": true})
}

func (d *Dispatcher) transferPause(_ context.Context, req Request) Response {
	var params transferCancelParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.TaskID == "" {
		return errorResponse(req.ID, errTaskIDRequired)
	}
	if err := d.xfers.Pause(params.TaskID); err != nil {
		slog.Error(MethodTransferPause, "task", params.TaskID, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	slog.Info(MethodTransferPause, "task", params.TaskID)
	return okResponse(req.ID, map[string]any{"ok": true})
}

func (d *Dispatcher) transferResume(_ context.Context, req Request) Response {
	var params transferCancelParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.TaskID == "" {
		return errorResponse(req.ID, errTaskIDRequired)
	}
	if err := d.xfers.Resume(params.TaskID); err != nil {
		slog.Error(MethodTransferResume, "task", params.TaskID, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	slog.Info(MethodTransferResume, "task", params.TaskID)
	return okResponse(req.ID, map[string]any{"ok": true})
}

func (d *Dispatcher) transferList(_ context.Context, req Request) Response {
	var params transferListParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	tasks := d.xfers.List(params.SessionID)
	return okResponse(req.ID, map[string]any{"tasks": tasks})
}

// fileRead 读取远程文件文本内容，单次上限 maxFileReadSize。
func (d *Dispatcher) fileRead(_ context.Context, req Request) Response {
	var params fileReadParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" || params.Path == "" {
		return errorResponse(req.ID, errSessionIDPathRequired)
	}
	path := normalizeRemotePath(params.Path)
	var data []byte
	err := d.withSessionTryLock(params.SessionID, func(conn *ftp.ServerConn) error {
		resp, retrErr := conn.Retr(path)
		if retrErr != nil {
			return retrErr
		}
		defer resp.Close()
		limited := io.LimitReader(resp, maxFileReadSize+1)
		var readErr error
		data, readErr = io.ReadAll(limited)
		return readErr
	})
	if err != nil {
		if err.Error() == errSessionBusy {
			slog.Warn(MethodFileRead, "session", params.SessionID, "path", path, "reason", "busy")
		} else {
			slog.Error(MethodFileRead, "session", params.SessionID, "path", path, "err", err)
		}
		return errorResponse(req.ID, fmt.Sprintf("ftp: retr %q: %v", path, err))
	}
	if len(data) > maxFileReadSize {
		slog.Warn(MethodFileRead, "session", params.SessionID, "path", path, "reason", "too_large", "bytes", len(data))
		return errorResponse(req.ID, "file too large")
	}
	slog.Info(MethodFileRead, "session", params.SessionID, "path", path, "bytes", len(data))
	return okResponse(req.ID, map[string]any{
		"content": string(data),
		"size":    len(data),
	})
}

// fileWrite 将文本内容写回远程文件。
func (d *Dispatcher) fileWrite(_ context.Context, req Request) Response {
	var params fileWriteParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	if params.SessionID == "" || params.Path == "" {
		return errorResponse(req.ID, errSessionIDPathRequired)
	}
	path := normalizeRemotePath(params.Path)
	err := d.withSessionTryLock(params.SessionID, func(conn *ftp.ServerConn) error {
		return conn.Stor(path, bytes.NewReader([]byte(params.Content)))
	})
	if err != nil {
		if err.Error() == errSessionBusy {
			slog.Warn(MethodFileWrite, "session", params.SessionID, "path", path, "reason", "busy")
		} else {
			slog.Error(MethodFileWrite, "session", params.SessionID, "path", path, "err", err)
		}
		return errorResponse(req.ID, fmt.Sprintf("ftp: stor %q: %v", path, err))
	}
	slog.Info(MethodFileWrite, "session", params.SessionID, "path", path, "bytes", len(params.Content))
	return okResponse(req.ID, map[string]any{"written": true})
}

func (d *Dispatcher) getSession(sessionID string) (*session, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	s, ok := d.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("ftp: session not found: %s", sessionID)
	}
	return s, nil
}

func (d *Dispatcher) closeSession(sessionID string) error {
	d.mu.Lock()
	s, ok := d.sessions[sessionID]
	if !ok {
		d.mu.Unlock()
		return fmt.Errorf("ftp: session not found: %s", sessionID)
	}
	delete(d.sessions, sessionID)
	d.mu.Unlock()
	stopSessionKeepalive(s)
	d.xfers.StopSession(sessionID)
	var connErr error
	if s.conn != nil {
		connErr = s.conn.Quit()
	}
	// 关闭 SSH 隧道（若有）；在 FTP 连接关闭之后执行，避免 Quit 因网络中断提前失败。
	if s.tunnelStop != nil {
		s.tunnelStop()
	}
	return connErr
}

// dialFTPWithTunnel 先（可选）建立 SSH 隧道，再调用 dialFTP。
// 返回的 stop 函数在调用方关闭会话时调用以释放隧道资源；无隧道时 stop 为 nil。
func dialFTPWithTunnel(ctx context.Context, params ConnectParams) (*ftp.ServerConn, func(), error) {
	var stop func()
	if params.Options.Tunnel.Enabled() {
		host, port, s, err := tunnel.StartSSHTunnel(
			ctx,
			params.Options.Tunnel,
			params.HostAddress,
			params.PortNumber,
		)
		if err != nil {
			return nil, nil, fmt.Errorf("ftp: ssh tunnel: %w", err)
		}
		// 把连接目标替换为本地隧道端口，保留其余参数不变。
		params.HostAddress = host
		params.PortNumber = port
		stop = s
	}
	conn, err := dialFTP(ctx, params)
	if err != nil {
		if stop != nil {
			stop()
		}
		return nil, nil, err
	}
	return conn, stop, nil
}

// dialFTP 根据 ConnectParams 建立 FTP/FTPS 连接。
//
// TLS 模式由 Options.TLSMode 决定：
//   - "none"     → 明文 FTP
//   - "explicit" → FTPS Explicit（AUTH TLS，端口默认 21）
//   - "implicit" → FTPS Implicit（TLS 直连，端口默认 990）
//
// 当 Options.Protocol 为 "ftps" 且 TLSMode 为空或 "none" 时，自动回退到 explicit 模式。
// Options.TLSVerify 为 false 时跳过服务端证书校验（适用于自签名证书场景）。
func dialFTP(ctx context.Context, params ConnectParams) (*ftp.ServerConn, error) {
	if params.HostAddress == "" {
		return nil, fmt.Errorf("ftp: host required")
	}

	// 确定实际生效的 TLS 模式：protocol=ftps 且未显式指定 tls_mode 时默认 explicit。
	tlsMode := params.Options.TLSMode
	if params.Options.Protocol == "ftps" && (tlsMode == "" || tlsMode == tlsModeNone) {
		tlsMode = tlsModeExplicit
	}

	port := params.PortNumber
	if port == 0 {
		if tlsMode == tlsModeImplicit {
			port = defaultFTPSImplPort
		} else {
			port = defaultFTPPort
		}
	}
	addr := fmt.Sprintf("%s:%d", params.HostAddress, port)

	timeout := defaultDialTimeout
	if secs := params.Options.effectiveTimeoutSeconds(); secs > 0 {
		timeout = time.Duration(secs) * time.Second
	}

	var opts []ftp.DialOption
	opts = append(opts, ftp.DialWithTimeout(timeout))

	if params.Options.Passive {
		opts = append(opts, ftp.DialWithDisabledEPSV(true))
	}
	if params.Options.Encoding == encodingGBK {
		opts = append(opts, ftp.DialWithDisabledUTF8(true))
	}

	dialFn := func(network, address string) (net.Conn, error) {
		return dialTCP(ctx, params.Options.Proxy, network, address, timeout)
	}
	opts = append(opts, ftp.DialWithDialFunc(dialFn))

	switch tlsMode {
	case tlsModeExplicit:
		// Explicit TLS：先建明文连接，再通过 AUTH TLS 升级为 TLS。
		opts = append(opts, ftp.DialWithExplicitTLS(buildTLSConfig(params.HostAddress, params.Options.TLSVerify)))
	case tlsModeImplicit:
		// Implicit TLS：整个连接从握手阶段就走 TLS（类似 HTTPS）。
		// DialWithTLS 会将 DialWithDialFunc 建立的连接直接当作 TLS 连接处理。
		opts = append(opts, ftp.DialWithTLS(buildTLSConfig(params.HostAddress, params.Options.TLSVerify)))
	}

	conn, err := ftp.Dial(addr, opts...)
	if err != nil {
		return nil, fmt.Errorf("ftp: dial %s: %w", addr, err)
	}

	account := params.LoginAccount
	password := params.Secret
	if params.Options.Anonymous {
		account = "anonymous"
		if password == "" {
			password = "anonymous@"
		}
	}
	if err := conn.Login(account, password); err != nil {
		_ = conn.Quit()
		return nil, fmt.Errorf("ftp: login: %w", err)
	}

	// ASCII 模式：登录后立即切换，避免在二进制文件上产生行尾转换。
	if params.Options.TransferType == transferTypeASCII {
		if err := conn.Type(ftp.TransferTypeASCII); err != nil {
			_ = conn.Quit()
			return nil, fmt.Errorf("ftp: set transfer type ASCII: %w", err)
		}
	}

	return conn, nil
}

// buildTLSConfig 根据主机名和证书校验开关构造 TLS 配置。
//
// tlsVerify 为 false 时设置 InsecureSkipVerify，适用于自签名或内网证书场景。
func buildTLSConfig(host string, tlsVerify bool) *tls.Config {
	return &tls.Config{
		ServerName:         host,
		InsecureSkipVerify: !tlsVerify, //nolint:gosec // 由用户在连接配置中显式控制
	}
}

func toFtpEntry(ent *ftp.Entry) FtpEntry {
	kind := "file"
	switch ent.Type {
	case ftp.EntryTypeFolder:
		kind = "dir"
	case ftp.EntryTypeLink:
		kind = "link"
	}
	modified := ""
	if !ent.Time.IsZero() {
		modified = ent.Time.UTC().Format(time.RFC3339)
	}
	return FtpEntry{
		Name:        ent.Name,
		Kind:        kind,
		Size:        int64(ent.Size),
		ModifiedAt:  modified,
		Permissions: "",
	}
}

func normalizeRemotePath(p string) string {
	if p == "" || p == "/" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

// leaveDeleteTargetIfInside 删除目录前若当前工作目录位于目标路径内，先切换到父目录。
func leaveDeleteTargetIfInside(conn *ftp.ServerConn, target string) {
	target = normalizeRemotePath(target)
	// 可能出现 CWD 在 target 的深层子目录中，因此持续向上切直到不再处于 target 内。
	for i := 0; i < 16; i++ {
		pwd, err := conn.CurrentDir()
		if err != nil {
			return
		}
		pwd = normalizeRemotePath(pwd)
		if pwd == target || strings.HasPrefix(pwd, target+"/") {
			parent := path.Dir(pwd)
			if parent == "." || parent == "" {
				parent = "/"
			}
			if cdErr := conn.ChangeDir(parent); cdErr != nil {
				return
			}
			continue
		}
		return
	}
}

// removeRemoteDirRecursiveSafe 使用“列目录→递归删除子项→移除目录”实现递归删除，
// 避免 ftp 库 RemoveDirRecur 在某些情况下对 CWD 的假设导致失败。
func removeRemoteDirRecursiveSafe(conn *ftp.ServerConn, dir string) error {
	dir = normalizeRemotePath(dir)
	leaveDeleteTargetIfInside(conn, dir)

	entries, err := conn.List(dir)
	if err != nil {
		return fmt.Errorf("list %q: %w", dir, err)
	}

	for _, ent := range entries {
		childPath := normalizeRemotePath(path.Join(dir, ent.Name))
		switch ent.Type {
		case ftp.EntryTypeFolder:
			if err := removeRemoteDirRecursiveSafe(conn, childPath); err != nil {
				return err
			}
		default:
			// 文件/链接：直接按路径删除。
			// Delete 不依赖当前工作目录，且目录删除前我们已确保不在子目录内。
			if err := conn.Delete(childPath); err != nil {
				return fmt.Errorf("delete %q: %w", childPath, err)
			}
		}
	}

	leaveDeleteTargetIfInside(conn, dir)
	if err := conn.RemoveDir(dir); err != nil {
		return fmt.Errorf("remove dir %q: %w", dir, err)
	}
	return nil
}

func okResponse(id string, result any) Response {
	encoded, err := json.Marshal(result)
	if err != nil {
		return errorResponse(id, fmt.Sprintf("marshal result: %v", err))
	}
	return Response{ID: id, OK: true, Result: string(encoded)}
}

func errorResponse(id, message string) Response {
	return Response{ID: id, OK: false, Error: message}
}

func marshalResponse(resp Response) []byte {
	out, err := json.Marshal(resp)
	if err != nil {
		return []byte(`{"ok":false,"error":"internal marshal error","result":""}`)
	}
	return out
}
