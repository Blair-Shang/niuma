// Package handler 实现 ftp-service 的 IPC 方法分发与会话管理。
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"path"
	"strings"
	"sync"
	"time"

	"niuma/services/ftp-service/internal/eventpub"
	"niuma/services/ftp-service/internal/idgen"
	"niuma/services/ftp-service/internal/transfer"

	"github.com/jlaffaye/ftp"
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
	Protocol         string        `json:"protocol"`
	TLSMode          string        `json:"tls_mode"`
	Passive          bool          `json:"passive"`
	Encoding         string        `json:"encoding"`
	TransferType     string        `json:"transfer_type"`
	TLSVerify        bool          `json:"tls_verify"`
	TimeoutSeconds   int           `json:"timeout_seconds"`
	KeepaliveSeconds int           `json:"keepalive_seconds"`
	Anonymous        bool          `json:"anonymous"`
	Proxy            *ProxyOptions `json:"proxy,omitempty"`
}

// ConnectParams 是建连参数（含明文密码，仅进程内使用）。
type ConnectParams struct {
	HostAddress  string         `json:"hostAddress"`
	PortNumber   int            `json:"portNumber"`
	LoginAccount string         `json:"loginAccount"`
	Password     string         `json:"password"`
	Options      ConnectOptions `json:"options"`
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
	id   string
	conn *ftp.ServerConn
	mu   sync.Mutex
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
	conn, err := dialFTP(ctx, params.ConnectParams)
	if err != nil {
		slog.Error(MethodSessionOpen, "host", params.HostAddress, "port", params.PortNumber, "err", err)
		return errorResponse(req.ID, err.Error())
	}
	sessionID, err := d.ids.NextString()
	if err != nil {
		_ = conn.Quit()
		return errorResponse(req.ID, err.Error())
	}
	d.mu.Lock()
	d.sessions[sessionID] = &session{id: sessionID, conn: conn}
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
		return errorResponse(req.ID, err.Error())
	}
	slog.Info("session.close", "session", params.SessionID)
	return okResponse(req.ID, map[string]any{"closed": true})
}

func (d *Dispatcher) sessionTest(ctx context.Context, req Request) Response {
	var params ConnectParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf(errInvalidParamsFmt, err))
	}
	conn, err := dialFTP(ctx, params)
	if err != nil {
		return okResponse(req.ID, map[string]any{"ok": false, "message": err.Error()})
	}
	_ = conn.Quit()
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
	s, err := d.getSession(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	path := normalizeRemotePath(params.Path)
	s.mu.Lock()
	entries, err := s.conn.List(path)
	s.mu.Unlock()
	if err != nil {
		return errorResponse(req.ID, fmt.Sprintf("ftp: list %q: %v", path, err))
	}
	out := make([]FtpEntry, 0, len(entries))
	for _, ent := range entries {
		out = append(out, toFtpEntry(ent))
	}
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
	s, err := d.getSession(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	path := normalizeRemotePath(params.Path)
	s.mu.Lock()
	err = s.conn.MakeDir(path)
	s.mu.Unlock()
	if err != nil {
		slog.Error(MethodDirMake, "session", params.SessionID, "path", path, "err", err)
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
	s, err := d.getSession(params.SessionID)
	if err != nil {
		slog.Warn(MethodEntryDelete, "result", "rejected", "session", params.SessionID, "reason", err.Error())
		return errorResponse(req.ID, err.Error())
	}
	targetPath := normalizeRemotePath(params.Path)
	kind := params.Kind
	if kind == "" {
		kind = "file"
	}
	s.mu.Lock()
	if kind == "dir" {
		if params.Recursive {
			err = removeRemoteDirRecursiveSafe(s.conn, targetPath)
		} else {
			leaveDeleteTargetIfInside(s.conn, targetPath)
			err = s.conn.RemoveDir(targetPath)
		}
	} else {
		err = s.conn.Delete(targetPath)
	}
	// 失败时记录当前 CWD，便于定位 ftp 库的递归删除/切目录假设问题。
	cwd, _ := s.conn.CurrentDir()
	s.mu.Unlock()
	if err != nil {
		slog.Error(MethodEntryDelete,
			"session", params.SessionID,
			"path", targetPath,
			"kind", kind,
			"recursive", params.Recursive,
			"cwd", normalizeRemotePath(cwd),
			"result", "failed",
			"err", err,
		)
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
	s, err := d.getSession(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	fromPath := normalizeRemotePath(params.FromPath)
	toPath := normalizeRemotePath(params.ToPath)
	s.mu.Lock()
	err = s.conn.Rename(fromPath, toPath)
	s.mu.Unlock()
	if err != nil {
		slog.Error(MethodEntryRename, "session", params.SessionID, "from", fromPath, "to", toPath, "err", err)
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
		return errorResponse(req.ID, err.Error())
	}
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
		return errorResponse(req.ID, err.Error())
	}
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
		return errorResponse(req.ID, err.Error())
	}
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
	s, err := d.getSession(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	path := normalizeRemotePath(params.Path)
	s.mu.Lock()
	resp, err := s.conn.Retr(path)
	s.mu.Unlock()
	if err != nil {
		return errorResponse(req.ID, fmt.Sprintf("ftp: retr %q: %v", path, err))
	}
	defer resp.Close()

	limited := io.LimitReader(resp, maxFileReadSize+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return errorResponse(req.ID, fmt.Sprintf("ftp: read %q: %v", path, err))
	}
	if len(data) > maxFileReadSize {
		return errorResponse(req.ID, "file too large")
	}
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
	s, err := d.getSession(params.SessionID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	path := normalizeRemotePath(params.Path)
	s.mu.Lock()
	err = s.conn.Stor(path, bytes.NewReader([]byte(params.Content)))
	s.mu.Unlock()
	if err != nil {
		slog.Error(MethodFileWrite, "session", params.SessionID, "path", path, "err", err)
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
	d.xfers.CancelSession(sessionID)
	if s.conn != nil {
		return s.conn.Quit()
	}
	return nil
}

func dialFTP(ctx context.Context, params ConnectParams) (*ftp.ServerConn, error) {
	if params.HostAddress == "" {
		return nil, fmt.Errorf("ftp: host required")
	}
	port := params.PortNumber
	if port == 0 {
		port = 21
	}
	addr := fmt.Sprintf("%s:%d", params.HostAddress, port)

	timeout := defaultDialTimeout
	if params.Options.TimeoutSeconds > 0 {
		timeout = time.Duration(params.Options.TimeoutSeconds) * time.Second
	}

	var opts []ftp.DialOption
	opts = append(opts, ftp.DialWithTimeout(timeout))
	if params.Options.Passive {
		opts = append(opts, ftp.DialWithDisabledEPSV(true))
	}
	dialFn := func(network, address string) (net.Conn, error) {
		return dialTCP(ctx, params.Options.Proxy, network, address, timeout)
	}
	opts = append(opts, ftp.DialWithDialFunc(dialFn))

	var conn *ftp.ServerConn
	var err error
	if params.Options.Protocol == "ftps" {
		conn, err = ftp.Dial(addr, append(opts, ftp.DialWithExplicitTLS(nil))...)
	} else {
		conn, err = ftp.Dial(addr, opts...)
	}
	if err != nil {
		return nil, fmt.Errorf("ftp: dial %s: %w", addr, err)
	}

	account := params.LoginAccount
	password := params.Password
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
	return conn, nil
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
