// Package debug 实现 Vastbase 存储过程调试（DBE_PLDEBUGGER 双连接编排）。
//
// 公开面是库内 SQL 函数；本包用两条 pgx 独占连接扮演 server / debug 角色，
// 不引入 Java / JDBC。契约见 docs/22-vastbase-module.md §5.5 / §6。
package debug

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"niuma/services/vastbase-service/internal/idgen"
	"niuma/services/vastbase-service/internal/session"
)

// Emitter 上报调试事件。
type Emitter func(payload map[string]any)

// Capabilities 描述目标实例是否可调试。
type Capabilities struct {
	Available                bool   `json:"available"`
	Reason                   string `json:"reason,omitempty"`
	Schema                   string `json:"schema,omitempty"`
	Version                  string `json:"version,omitempty"`
	HasDebuggerRole          bool   `json:"hasDebuggerRole"`
	AddBreakpointFuncoidKind string `json:"addBreakpointFuncoidKind,omitempty"`
}

const (
	StateStarting = "starting"
	StateAttached = "attached"
	StatePaused   = "paused"
	StateRunning  = "running"
	StateFinished = "finished"
	StateAborted  = "aborted"
	StateError    = "error"
)

const maxSessionsPerOwner = 2

// StartParams 启动调试会话。
type StartParams struct {
	OwnerSessionID string
	Connect        session.ConnectParams
	Database       string
	Schema         string
	Name           string
	ArgsIdentity   string // identity args；可选
	OID            uint32
	// CallArgs 为例程调用参数表达式（已由前端拼装，如 `1, 'x'`），不含外层括号。
	CallArgs string
	Kind     string // function | procedure
}

// Position 是当前调试位置。
type Position struct {
	FuncOID  uint32 `json:"funcoid"`
	FuncName string `json:"funcname,omitempty"`
	Line     int    `json:"line"`
	Query    string `json:"query,omitempty"`
}

// StartResult 启动返回。
type StartResult struct {
	DebugID string   `json:"debugId"`
	State   string   `json:"state"`
	OID     uint32   `json:"oid"`
	Pos     Position `json:"position"`
}

// CodeLine 是 info_code 一行。
// Line 为编辑器行号（结果集顺序，从 1 起）；DebugLine 为厂商 lineno（断点 / 当前位置用）。
type CodeLine struct {
	Line      int    `json:"line"`
	DebugLine int    `json:"debugLine"`
	Code      string `json:"code"`
	CanBreak  bool   `json:"canBreak"`
}

// Variable 是 info_locals 一项。
type Variable struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Value       string `json:"value"`
	PackageName string `json:"packageName,omitempty"`
}

// StackFrame 是 backtrace 一帧。
type StackFrame struct {
	FrameNo  int    `json:"frameNo"`
	FuncOID  uint32 `json:"funcoid"`
	FuncName string `json:"funcname"`
	Line     int    `json:"line"`
	Query    string `json:"query,omitempty"`
}

// Breakpoint 是断点。
type Breakpoint struct {
	Number int    `json:"number"`
	OID    uint32 `json:"funcoid"`
	Line   int    `json:"line"`
	Enable bool   `json:"enable"`
	Query  string `json:"query,omitempty"`
}

// Manager 管理调试会话。
type Manager struct {
	ids  idgen.Generator
	emit Emitter

	mu       sync.Mutex
	sessions map[string]*debugSession
}

type debugSession struct {
	id             string
	ownerSessionID string
	oid            uint32
	kind           string
	schema         string
	name           string
	callSQL        string

	serverPool *pgxpool.Pool
	debugPool  *pgxpool.Pool
	// debugConn：attach 后独占持有，避免池化换连丢失会话态；错误探测查询也会作废 attach。
	debugConn *pgxpool.Conn
	debugMu   sync.Mutex // 串行化 debugConn 上的 SQL（pgx.Conn 非并发安全）
	// serverConn：执行 CALL 的独占连接；须与 Exec 同连接才能 drain DBMS_OUTPUT。
	serverConn *pgxpool.Conn
	serverMu   sync.Mutex
	// addBpFuncoidKind：add_breakpoint 首参类型（oid|text），来自 pg_proc，禁止试错调用。
	addBpFuncoidKind string
	serverStop       func()
	debugStop        func()

	serverCancel context.CancelFunc

	mu    sync.Mutex
	state string
	pos   Position
	// execDone / execErr：server 侧例程是否已结束（区分「未挂起就结束」与「尚在等待」）。
	execDone bool
	execErr  error
	// output：DBMS_OUTPUT / DBE_OUTPUT 拉取结果（例程结束后填充）。
	output []string
	// notices：server 连接上收集的 NOTICE（部分版本 PUT_LINE 会 NOTICE 回显）。
	notices *NoticeSink
	// outputPkg：ENABLE 探针成功的包名；outputDiag：失败诊断。
	outputPkg  string
	outputDiag string
}

const (
	attachRetryInterval = 40 * time.Millisecond
	attachRetryTimeout  = 8 * time.Second
)

// errAttachFinishedEarly 例程在 attach 前已跑完（常见于仅 RETURN、无可挂起 SQL 的函数）。
// 前端可按 SQLSTATE D0011 / ERR_ATTACH_FINISHED_EARLY 映射本地化文案。
const errAttachFinishedEarly = "vastbase: attach: ERR_ATTACH_FINISHED_EARLY (SQLSTATE D0011): " +
	"routine finished before debugger attached. " +
	"DBE_PLDEBUGGER hangs only before the first SQL statement in a plpgsql body; " +
	"expression-only RETURN (e.g. RETURN NLSSORT(...)) completes instantly. " +
	"Add a real SQL statement before RETURN, e.g. PERFORM 1; or SELECT 1 INTO dummy;, " +
	"ensure LANGUAGE plpgsql (not sql), and that the account has gs_role_pldebugger."

// errAttachTimeout 例程仍在跑但窗口内未能 attach（隧道慢、turn_on 错会话、权限等）。
const errAttachTimeout = "vastbase: attach: ERR_ATTACH_TIMEOUT: " +
	"debugger did not attach while the routine was still running. " +
	"Check SSH tunnel latency, that turn_on and CALL share one server connection, " +
	"and that the account is a member of gs_role_pldebugger."

// NewManager 创建调试管理器。
func NewManager(ids idgen.Generator, emit Emitter) *Manager {
	return &Manager{
		ids:      ids,
		emit:     emit,
		sessions: make(map[string]*debugSession),
	}
}

// ProbeCapabilities 探测 DBE_PLDEBUGGER 是否可用（schema、角色、版本、断点签名）。
func ProbeCapabilities(ctx context.Context, pool *pgxpool.Pool) (*Capabilities, error) {
	if pool == nil {
		return nil, fmt.Errorf("vastbase: pool required")
	}
	var exists bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM pg_namespace WHERE nspname = 'dbe_pldebugger'
)`).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("vastbase: probe debugger: %w", err)
	}

	var version string
	_ = pool.QueryRow(ctx, `SELECT current_setting('server_version', true)`).Scan(&version)

	hasRole, roleKnown := probeHasDebuggerRole(ctx, pool)
	bpKind := resolveAddBreakpointFuncoidKindPool(ctx, pool)

	if !exists {
		return &Capabilities{
			Available:       false,
			Reason:          "dbe_pldebugger schema not found (extension not installed)",
			Version:         version,
			HasDebuggerRole: hasRole,
		}, nil
	}
	if roleKnown && !hasRole {
		return &Capabilities{
			Available:                false,
			Reason:                   "current user is not a member of gs_role_pldebugger (and not superuser)",
			Schema:                   "dbe_pldebugger",
			Version:                  version,
			HasDebuggerRole:          false,
			AddBreakpointFuncoidKind: bpKind,
		}, nil
	}
	reason := ""
	if !roleKnown {
		reason = "debugger role probe inconclusive; start may still fail without gs_role_pldebugger"
	}
	return &Capabilities{
		Available:                true,
		Reason:                   reason,
		Schema:                   "dbe_pldebugger",
		Version:                  version,
		HasDebuggerRole:          hasRole,
		AddBreakpointFuncoidKind: bpKind,
	}, nil
}

// probeHasDebuggerRole 返回 (是否有权, 探测是否可信)。探测失败时 known=false，不据此禁用调试入口。
func probeHasDebuggerRole(ctx context.Context, pool *pgxpool.Pool) (ok bool, known bool) {
	err := pool.QueryRow(ctx, `
SELECT
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper)
  OR EXISTS (
    SELECT 1
    FROM pg_roles r
    WHERE r.rolname = 'gs_role_pldebugger'
      AND pg_has_role(current_user, r.oid, 'MEMBER')
  )`).Scan(&ok)
	if err != nil {
		slog.Debug("debug.capabilities.role_probe_fail", "err", err.Error())
		return false, false
	}
	return ok, true
}

// resolveAddBreakpointFuncoidKindPool 在普通池上探测签名（未 attach 时可用）。
func resolveAddBreakpointFuncoidKindPool(ctx context.Context, pool *pgxpool.Pool) string {
	if pool == nil {
		return ""
	}
	rows, err := pool.Query(ctx, `
SELECT pg_catalog.pg_get_function_identity_arguments(p.oid)
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'dbe_pldebugger' AND p.proname = 'add_breakpoint'`)
	if err != nil {
		return ""
	}
	defer rows.Close()
	hasOID, hasText := false, false
	for rows.Next() {
		var args string
		if err := rows.Scan(&args); err != nil {
			continue
		}
		a := strings.ToLower(strings.TrimSpace(args))
		if strings.HasPrefix(a, "oid") {
			hasOID = true
		}
		if strings.HasPrefix(a, "text") {
			hasText = true
		}
	}
	if hasOID {
		return "oid"
	}
	if hasText {
		return "text"
	}
	return ""
}

func (m *Manager) emitState(debugID, state string, pos *Position, message string) {
	if m.emit == nil {
		return
	}
	payload := map[string]any{
		"type":    "vastbase.debug.state",
		"debugId": debugID,
		"state":   state,
	}
	if pos != nil {
		payload["funcoid"] = pos.FuncOID
		payload["line"] = pos.Line
		payload["funcname"] = pos.FuncName
		payload["query"] = pos.Query
	}
	if message != "" {
		payload["message"] = message
	}
	if s, err := m.get(debugID); err == nil {
		if out := s.copyOutput(); len(out) > 0 {
			payload["output"] = out
		}
	}
	m.emit(payload)

	if state == StatePaused && pos != nil {
		m.emit(map[string]any{
			"type":     "vastbase.debug.paused",
			"debugId":  debugID,
			"funcoid":  pos.FuncOID,
			"line":     pos.Line,
			"funcname": pos.FuncName,
			"query":    pos.Query,
		})
	}
}

// Start 启动调试：turn_on → 异步执行例程 → attach。
func (m *Manager) Start(ctx context.Context, params StartParams) (*StartResult, error) {
	if strings.TrimSpace(params.OwnerSessionID) == "" {
		return nil, fmt.Errorf("vastbase: owner sessionId required")
	}

	m.mu.Lock()
	ownerCount := 0
	for _, s := range m.sessions {
		if s.ownerSessionID == params.OwnerSessionID {
			ownerCount++
		}
	}
	m.mu.Unlock()
	if ownerCount >= maxSessionsPerOwner {
		return nil, fmt.Errorf("vastbase: at most %d debug sessions per connection", maxSessionsPerOwner)
	}

	connectParams := params.Connect
	if db := strings.TrimSpace(params.Database); db != "" {
		connectParams.Options.Database = db
	}

	// 隧道只启一次：server / debug 两条独占连接共用本地转发口（与文档「同一 tunnel」一致）
	dialParams, sharedTunnelStop, err := session.PrepareDialParams(ctx, connectParams)
	if err != nil {
		return nil, fmt.Errorf("vastbase: debug tunnel: %w", err)
	}

	noticeSink := &NoticeSink{}
	serverPool, serverLocalStop, err := session.ConnectExclusiveWithNotice(ctx, dialParams, noticeSink.Handler())
	if err != nil {
		if sharedTunnelStop != nil {
			sharedTunnelStop()
		}
		return nil, fmt.Errorf("vastbase: debug server conn: %w", err)
	}
	serverStop := combineStops(sharedTunnelStop, serverLocalStop)

	oid := params.OID
	if oid == 0 {
		oid, err = resolveOIDOnPool(ctx, serverPool, params.Schema, params.Name, params.ArgsIdentity)
		if err != nil {
			closePools(serverPool, serverStop, nil, nil)
			return nil, err
		}
	}
	if err := checkRoutineDebuggable(ctx, serverPool, oid); err != nil {
		closePools(serverPool, serverStop, nil, nil)
		return nil, err
	}

	debugPool, debugLocalStop, err := session.ConnectExclusive(ctx, dialParams)
	if err != nil {
		closePools(serverPool, serverStop, nil, nil)
		return nil, fmt.Errorf("vastbase: debug control conn: %w", err)
	}
	debugStop := debugLocalStop
	debugConn, err := debugPool.Acquire(ctx)
	if err != nil {
		closePools(serverPool, serverStop, debugPool, debugStop)
		return nil, fmt.Errorf("vastbase: debug control acquire: %w", err)
	}

	debugID, err := m.ids.NextString()
	if err != nil {
		debugConn.Release()
		closePools(serverPool, serverStop, debugPool, debugStop)
		return nil, err
	}

	kind := strings.ToLower(strings.TrimSpace(params.Kind))
	if kind == "" {
		kind = "procedure"
	}
	callSQL := buildCallSQL(kind, params.Schema, params.Name, params.CallArgs)
	execSQL := buildDebugExecSQL(kind, params.Schema, params.Name, params.CallArgs)

	// 先独占 serverConn：ENABLE → turn_on → 再 ENABLE → CALL
	// turn_on 可能影响会话态；ENABLE 放两边，且启用阶段不做 probe DDL。
	serverConn, err := serverPool.Acquire(ctx)
	if err != nil {
		debugConn.Release()
		closePools(serverPool, serverStop, debugPool, debugStop)
		return nil, fmt.Errorf("vastbase: debug server acquire: %w", err)
	}

	en := enableServerOutput(ctx, serverConn.Conn())
	_ = noticeSink.Take()

	var nodename string
	var port int
	err = serverConn.QueryRow(ctx, `SELECT nodename, port FROM dbe_pldebugger.turn_on($1)`, oid).Scan(&nodename, &port)
	if err != nil {
		serverConn.Release()
		debugConn.Release()
		closePools(serverPool, serverStop, debugPool, debugStop)
		return nil, fmt.Errorf("vastbase: turn_on: %w", err)
	}

	refreshServerOutputEnable(ctx, serverConn.Conn())
	_ = noticeSink.Take()
	if en.Pkg == "" {
		// turn_on 后重试一次 ENABLE
		en = enableServerOutput(ctx, serverConn.Conn())
		_ = noticeSink.Take()
	}

	ds := &debugSession{
		id:             debugID,
		ownerSessionID: params.OwnerSessionID,
		oid:            oid,
		kind:           kind,
		schema:         params.Schema,
		name:           params.Name,
		callSQL:        callSQL,
		serverPool:     serverPool,
		debugPool:      debugPool,
		debugConn:      debugConn,
		serverConn:     serverConn,
		serverStop:     serverStop,
		debugStop:      debugStop,
		state:          StateStarting,
		notices:        noticeSink,
		outputPkg:      en.Pkg,
		outputDiag:     en.Diag,
	}

	m.mu.Lock()
	m.sessions[debugID] = ds
	m.mu.Unlock()

	m.emitState(debugID, StateStarting, nil, "")

	serverCtx, cancel := context.WithCancel(context.Background())
	ds.serverCancel = cancel

	go func() {
		ds.serverMu.Lock()
		conn := serverConn.Conn()
		// 与函数一致：顶层 CALL/SELECT（SimpleProtocol）+ 结束后 drain
		_, execErr := execSimple(serverCtx, conn, execSQL)

		drainCtx, drainCancel := context.WithTimeout(context.Background(), 5*time.Second)
		prepareConnForDrain(drainCtx, conn)
		drained := mergeOutputSources(
			noticeSink.Take(),
			drainServerOutput(drainCtx, conn),
		)
		if len(drained) == 0 {
			// 兜底：GET_LINE → RAISE NOTICE → NoticeSink
			drainViaRaiseNotice(drainCtx, conn)
			drained = mergeOutputSources(drained, noticeSink.Take())
		}
		drainCancel()
		ds.serverMu.Unlock()

		if len(drained) > 0 {
			ds.appendOutput(drained...)
		} else if ds.outputPkg == "" {
			msg := "# DBMS_OUTPUT：会话 ENABLE/GET_LINE 探针失败（库端包不可用或语法不兼容）"
			if ds.outputDiag != "" {
				msg = "# DBMS_OUTPUT：" + ds.outputDiag
			}
			ds.appendOutput(msg)
		} else if execErr == nil {
			slog.Info("debug.dbms_output.empty",
				"debugId", debugID,
				"enablePkg", ds.outputPkg,
				"callSQL", callSQL,
				"execSQL", execSQL,
			)
		}
		if execErr != nil {
			slog.Warn("debug.dbms_output.exec_err", "debugId", debugID, "err", execErr.Error(), "execSQL", execSQL)
		}
		slog.Info("debug.dbms_output.drain",
			"debugId", debugID,
			"enablePkg", ds.outputPkg,
			"callSQL", callSQL,
			"lines", len(drained),
			"execErr", execErr != nil,
		)

		ds.mu.Lock()
		ds.execDone = true
		ds.execErr = execErr
		cur := ds.state
		ds.mu.Unlock()
		if serverCtx.Err() != nil {
			return
		}
		if execErr != nil {
			if cur != StateAborted && cur != StateFinished {
				ds.setState(StateError)
				m.emitState(debugID, StateError, nil, execErr.Error())
			}
			return
		}
		ds.setState(StateFinished)
		m.emitState(debugID, StateFinished, &Position{FuncOID: oid, Line: 0, Query: "[EXECUTION FINISHED]"}, "")
	}()

	pos, err := m.attachWithRetry(ctx, ds, nodename, port)
	if err != nil {
		cancel()
		// 等 CALL goroutine 退出后再拆连接，避免对已 Release 的 conn drain
		waitExecDone(ds, 3*time.Second)
		_ = abortQuietConn(debugConn)
		debugConn.Release()
		ds.debugConn = nil
		ds.serverMu.Lock()
		if ds.serverConn != nil {
			cleanupDbmsHelpers(context.Background(), ds.serverConn.Conn())
			ds.serverConn.Release()
			ds.serverConn = nil
		}
		ds.serverMu.Unlock()
		_ = turnOff(context.Background(), serverPool, oid)
		m.remove(debugID)
		closePools(serverPool, serverStop, debugPool, debugStop)
		return nil, err
	}

	ds.debugMu.Lock()
	ds.addBpFuncoidKind = resolveAddBreakpointFuncoidKind(ctx, debugConn)
	ds.debugMu.Unlock()

	ds.mu.Lock()
	ds.state = StatePaused
	ds.pos = pos
	ds.mu.Unlock()
	m.emitState(debugID, StateAttached, &pos, "")
	m.emitState(debugID, StatePaused, &pos, "")

	return &StartResult{
		DebugID: debugID,
		State:   StatePaused,
		OID:     oid,
		Pos:     pos,
	}, nil
}

func (ds *debugSession) setState(state string) {
	ds.mu.Lock()
	ds.state = state
	ds.mu.Unlock()
}

func (ds *debugSession) appendOutput(lines ...string) {
	if len(lines) == 0 {
		return
	}
	ds.mu.Lock()
	defer ds.mu.Unlock()
	ds.output = append(ds.output, lines...)
	if len(ds.output) > 5000 {
		ds.output = ds.output[len(ds.output)-5000:]
	}
}

func (ds *debugSession) copyOutput() []string {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	if len(ds.output) == 0 {
		return nil
	}
	out := make([]string, len(ds.output))
	copy(out, ds.output)
	return out
}

// waitExecDone 等待 server 侧 CALL 结束（以便 drain 完成），超时则返回。
func waitExecDone(s *debugSession, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		done := s.execDone
		s.mu.Unlock()
		if done {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func (m *Manager) get(debugID string) (*debugSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[debugID]
	if !ok {
		return nil, fmt.Errorf("vastbase: debug session not found")
	}
	return s, nil
}

func (m *Manager) remove(debugID string) {
	m.mu.Lock()
	delete(m.sessions, debugID)
	m.mu.Unlock()
}

// ControlResult 步进类返回。
type ControlResult struct {
	State  string   `json:"state"`
	Pos    Position `json:"position"`
	Output []string `json:"output,omitempty"`
}

// StopResult 停止返回（含已拉取的 DBMS_OUTPUT）。
type StopResult struct {
	Stopped bool     `json:"stopped"`
	Output  []string `json:"output,omitempty"`
}

func (m *Manager) runControl(ctx context.Context, debugID, fn string) (*ControlResult, error) {
	s, err := m.get(debugID)
	if err != nil {
		return nil, err
	}
	if s.debugConn == nil {
		return nil, fmt.Errorf("vastbase: %s: debug connection not attached", fn)
	}
	s.setState(StateRunning)
	m.emitState(debugID, StateRunning, nil, "")

	s.debugMu.Lock()
	var pos Position
	err = s.debugConn.QueryRow(ctx,
		fmt.Sprintf(`SELECT funcoid, funcname, lineno, query FROM dbe_pldebugger.%s()`, fn),
	).Scan(&pos.FuncOID, &pos.FuncName, &pos.Line, &pos.Query)
	s.debugMu.Unlock()
	if err != nil {
		s.setState(StateError)
		m.emitState(debugID, StateError, nil, err.Error())
		return nil, fmt.Errorf("vastbase: %s: %w", fn, err)
	}

	finished := pos.Line == 0 || strings.Contains(strings.ToUpper(pos.Query), "EXECUTION FINISHED")
	state := StatePaused
	if finished {
		state = StateFinished
		waitExecDone(s, 5*time.Second)
	}
	s.mu.Lock()
	s.state = state
	s.pos = pos
	s.mu.Unlock()
	m.emitState(debugID, state, &pos, "")
	return &ControlResult{State: state, Pos: pos, Output: s.copyOutput()}, nil
}

func (m *Manager) Step(ctx context.Context, debugID string) (*ControlResult, error) {
	return m.runControl(ctx, debugID, "step")
}

func (m *Manager) Next(ctx context.Context, debugID string) (*ControlResult, error) {
	return m.runControl(ctx, debugID, "next")
}

func (m *Manager) Continue(ctx context.Context, debugID string) (*ControlResult, error) {
	return m.runControl(ctx, debugID, "continue")
}

func (m *Manager) Finish(ctx context.Context, debugID string) (*ControlResult, error) {
	return m.runControl(ctx, debugID, "finish")
}

// Abort 中止调试并清理。
func (m *Manager) Abort(ctx context.Context, debugID string) error {
	s, err := m.get(debugID)
	if err != nil {
		return err
	}
	_ = abortQuietConn(s.debugConn)
	s.setState(StateAborted)
	m.emitState(debugID, StateAborted, nil, "")
	_, err = m.Stop(ctx, debugID)
	return err
}

// Stop 释放双连接与 turn_off；返回已拉取的输出缓冲。
func (m *Manager) Stop(ctx context.Context, debugID string) (*StopResult, error) {
	s, err := m.get(debugID)
	if err != nil {
		return nil, err
	}
	waitExecDone(s, 2*time.Second)
	out := s.copyOutput()

	// 先 drain（同连接），再清理辅助对象与 cancel；drain 前不 ENABLE
	s.serverMu.Lock()
	if s.serverConn != nil {
		if len(out) == 0 {
			drainCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			prepareConnForDrain(drainCtx, s.serverConn.Conn())
			extra := mergeOutputSources(
				s.notices.Take(),
				drainServerOutput(drainCtx, s.serverConn.Conn()),
			)
			cancel()
			if len(extra) > 0 {
				s.appendOutput(extra...)
				out = s.copyOutput()
			}
		}
		cleanupDbmsHelpers(ctx, s.serverConn.Conn())
		s.serverConn.Release()
		s.serverConn = nil
	}
	s.serverMu.Unlock()

	if s.serverCancel != nil {
		s.serverCancel()
	}
	_ = abortQuietConn(s.debugConn)
	if s.debugConn != nil {
		s.debugConn.Release()
		s.debugConn = nil
	}
	_ = turnOff(ctx, s.serverPool, s.oid)
	closePools(s.serverPool, s.serverStop, s.debugPool, s.debugStop)
	m.remove(debugID)
	return &StopResult{Stopped: true, Output: out}, nil
}

// Source 返回 info_code。
// 必须用 SELECT * 按列名映射：错误列名探测会触发「调试中报错则 attach 作废」。
func (m *Manager) Source(ctx context.Context, debugID string) ([]CodeLine, error) {
	s, err := m.get(debugID)
	if err != nil {
		return nil, err
	}
	if s.debugConn == nil {
		return nil, fmt.Errorf("vastbase: info_code: debug connection not attached")
	}
	s.debugMu.Lock()
	out, err := fetchInfoCode(ctx, s.debugConn, s.oid)
	s.debugMu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("vastbase: info_code: %w", err)
	}
	return out, nil
}

func fetchInfoCode(ctx context.Context, conn *pgxpool.Conn, oid uint32) ([]CodeLine, error) {
	rows, err := conn.Query(ctx, `SELECT * FROM dbe_pldebugger.info_code($1)`, oid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fds := rows.FieldDescriptions()
	out := make([]CodeLine, 0)
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		var line CodeLine
		hasCanBreak := false
		for i, fd := range fds {
			name := strings.ToLower(string(fd.Name))
			v := vals[i]
			switch name {
			case "lineno", "line":
				line.DebugLine = toInt(v)
			case "query", "sourcecode", "code", "source":
				line.Code = toString(v)
			case "canbreak", "can_break":
				hasCanBreak = true
				if b, ok := v.(bool); ok {
					line.CanBreak = b
				}
			}
		}
		if !hasCanBreak {
			// 厂商：函数头 lineno 为空，仅函数体可断
			line.CanBreak = line.DebugLine > 0 && strings.TrimSpace(line.Code) != ""
		}
		out = append(out, line)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// 编辑器行号按返回顺序编号；断点 API 仍用 DebugLine（info_code.lineno）
	for i := range out {
		out[i].Line = i + 1
	}
	return out, nil
}

// Variables 返回 info_locals。
func (m *Manager) Variables(ctx context.Context, debugID string) ([]Variable, error) {
	s, err := m.get(debugID)
	if err != nil {
		return nil, err
	}
	if s.debugConn == nil {
		return nil, fmt.Errorf("vastbase: info_locals: debug connection not attached")
	}
	s.debugMu.Lock()
	defer s.debugMu.Unlock()
	// 勿先用错误签名探测：调试中任意 SQL 失败会作废 attach，随后 value 常变为 <UNKNOWN>
	rows, err := s.debugConn.Query(ctx, `SELECT * FROM dbe_pldebugger.info_locals()`)
	if err != nil {
		return nil, fmt.Errorf("vastbase: info_locals: %w", err)
	}
	defer rows.Close()
	return scanVariables(rows)
}

// Evaluate 通过 print_var 读取指定变量（观察表达式）。
// frameNo < 0 时使用无 frameno 重载（默认顶层栈）；勿在 attach 后试错其它签名。
func (m *Manager) Evaluate(ctx context.Context, debugID string, name string, frameNo int) (*Variable, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("vastbase: print_var: name required")
	}
	s, err := m.get(debugID)
	if err != nil {
		return nil, err
	}
	if s.debugConn == nil {
		return nil, fmt.Errorf("vastbase: print_var: debug connection not attached")
	}
	s.debugMu.Lock()
	defer s.debugMu.Unlock()
	var rows pgx.Rows
	if frameNo >= 0 {
		rows, err = s.debugConn.Query(ctx,
			`SELECT * FROM dbe_pldebugger.print_var($1::text, $2::integer)`,
			name, frameNo,
		)
	} else {
		rows, err = s.debugConn.Query(ctx,
			`SELECT * FROM dbe_pldebugger.print_var($1::text)`,
			name,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("vastbase: print_var: %w", err)
	}
	defer rows.Close()
	list, err := scanVariables(rows)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return &Variable{Name: name, Value: ""}, nil
	}
	return &list[0], nil
}

func scanVariables(rows pgx.Rows) ([]Variable, error) {
	fds := rows.FieldDescriptions()
	out := make([]Variable, 0)
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		var v Variable
		for i, fd := range fds {
			col := strings.ToLower(string(fd.Name))
			switch col {
			case "varname", "name":
				v.Name = toString(vals[i])
			case "vartype", "type", "typename":
				v.Type = toString(vals[i])
			case "value", "varvalue":
				v.Value = toString(vals[i])
			case "package_name", "packagename", "package":
				v.PackageName = toString(vals[i])
			}
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// Stack 返回 backtrace。
func (m *Manager) Stack(ctx context.Context, debugID string) ([]StackFrame, error) {
	s, err := m.get(debugID)
	if err != nil {
		return nil, err
	}
	if s.debugConn == nil {
		return nil, fmt.Errorf("vastbase: backtrace: debug connection not attached")
	}
	s.debugMu.Lock()
	defer s.debugMu.Unlock()
	rows, err := s.debugConn.Query(ctx, `SELECT * FROM dbe_pldebugger.backtrace()`)
	if err != nil {
		return nil, fmt.Errorf("vastbase: backtrace: %w", err)
	}
	defer rows.Close()
	fds := rows.FieldDescriptions()
	out := make([]StackFrame, 0)
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		var f StackFrame
		for i, fd := range fds {
			name := strings.ToLower(string(fd.Name))
			switch name {
			case "frameno", "frame_no", "frame":
				f.FrameNo = toInt(vals[i])
			case "funcoid", "oid":
				f.FuncOID = uint32(toInt(vals[i]))
			case "funcname", "name":
				f.FuncName = toString(vals[i])
			case "lineno", "line":
				f.Line = toInt(vals[i])
			case "query", "code", "sourcecode":
				f.Query = toString(vals[i])
			}
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// AddBreakpoint 添加断点。
// line 必须是 info_code.lineno（DebugLine），不是编辑器展示行号。
// 第二参必须 ::integer，否则会解析成 add_breakpoint(text, unknown) 报 42883。
func (m *Manager) AddBreakpoint(ctx context.Context, debugID string, line int) (*Breakpoint, error) {
	s, err := m.get(debugID)
	if err != nil {
		return nil, err
	}
	if s.debugConn == nil {
		return nil, fmt.Errorf("vastbase: add_breakpoint: debug connection not attached")
	}
	if line <= 0 {
		return nil, fmt.Errorf("vastbase: invalid breakpoint line %d (header lines are not breakable)", line)
	}
	s.debugMu.Lock()
	if s.addBpFuncoidKind == "" {
		s.addBpFuncoidKind = resolveAddBreakpointFuncoidKind(ctx, s.debugConn)
	}
	bpno, err := addBreakpoint(ctx, s.debugConn, s.oid, line, s.addBpFuncoidKind)
	s.debugMu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("vastbase: add_breakpoint: %w", err)
	}
	if bpno < 0 {
		return nil, fmt.Errorf("vastbase: invalid breakpoint at line %d (check canbreak)", line)
	}
	return &Breakpoint{Number: bpno, OID: s.oid, Line: line, Enable: true}, nil
}

// resolveAddBreakpointFuncoidKind 从目录读签名，禁止用错误重载试错（失败会作废 attach）。
// Vastbase / GaussDB 实例多为 (oid, integer)；部分 openGauss 文档写 (text, integer)。
func resolveAddBreakpointFuncoidKind(ctx context.Context, conn *pgxpool.Conn) string {
	if conn == nil {
		return "oid"
	}
	rows, err := conn.Query(ctx, `
SELECT pg_catalog.pg_get_function_identity_arguments(p.oid)
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'dbe_pldebugger' AND p.proname = 'add_breakpoint'`)
	if err != nil {
		return "oid"
	}
	defer rows.Close()
	hasOID, hasText := false, false
	for rows.Next() {
		var args string
		if err := rows.Scan(&args); err != nil {
			continue
		}
		a := strings.ToLower(strings.TrimSpace(args))
		if strings.HasPrefix(a, "oid") {
			hasOID = true
		}
		if strings.HasPrefix(a, "text") {
			hasText = true
		}
	}
	if hasOID {
		return "oid"
	}
	if hasText {
		return "text"
	}
	return "oid"
}

func addBreakpoint(ctx context.Context, conn *pgxpool.Conn, oid uint32, line int, funcoidKind string) (int, error) {
	// 第二参必须 ::integer；首参按目录签名选 oid/text，勿试错。
	var bpno int
	var err error
	switch funcoidKind {
	case "text":
		err = conn.QueryRow(ctx,
			`SELECT breakpointno FROM dbe_pldebugger.add_breakpoint($1::text, $2::integer)`,
			fmt.Sprintf("%d", oid), line,
		).Scan(&bpno)
	default:
		err = conn.QueryRow(ctx,
			`SELECT breakpointno FROM dbe_pldebugger.add_breakpoint($1::oid, $2::integer)`,
			oid, line,
		).Scan(&bpno)
	}
	if err != nil {
		return -1, err
	}
	return bpno, nil
}

// DeleteBreakpoint 删除断点。
func (m *Manager) DeleteBreakpoint(ctx context.Context, debugID string, breakpointNo int) error {
	s, err := m.get(debugID)
	if err != nil {
		return err
	}
	if s.debugConn == nil {
		return fmt.Errorf("vastbase: delete_breakpoint: debug connection not attached")
	}
	s.debugMu.Lock()
	_, err = s.debugConn.Exec(ctx, `SELECT dbe_pldebugger.delete_breakpoint($1)`, breakpointNo)
	s.debugMu.Unlock()
	if err != nil {
		return fmt.Errorf("vastbase: delete_breakpoint: %w", err)
	}
	return nil
}

// ListBreakpoints 列出断点。
func (m *Manager) ListBreakpoints(ctx context.Context, debugID string) ([]Breakpoint, error) {
	s, err := m.get(debugID)
	if err != nil {
		return nil, err
	}
	if s.debugConn == nil {
		return nil, fmt.Errorf("vastbase: info_breakpoints: debug connection not attached")
	}
	s.debugMu.Lock()
	defer s.debugMu.Unlock()
	rows, err := s.debugConn.Query(ctx, `SELECT * FROM dbe_pldebugger.info_breakpoints()`)
	if err != nil {
		return nil, fmt.Errorf("vastbase: info_breakpoints: %w", err)
	}
	defer rows.Close()
	fds := rows.FieldDescriptions()
	out := make([]Breakpoint, 0)
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		bp := Breakpoint{Enable: true, OID: s.oid}
		for i, fd := range fds {
			name := strings.ToLower(string(fd.Name))
			v := vals[i]
			switch name {
			case "breakpointno", "breakpoint_no", "bpnum", "breakpointnum":
				bp.Number = toInt(v)
			case "funcoid", "oid":
				bp.OID = uint32(toInt(v))
			case "lineno", "line", "linenumber", "line_no", "breakpointline":
				bp.Line = toInt(v)
			case "enable", "enabled":
				if b, ok := v.(bool); ok {
					bp.Enable = b
				}
			case "query", "code":
				if str, ok := v.(string); ok {
					bp.Query = str
				}
			}
		}
		out = append(out, bp)
	}
	return out, rows.Err()
}

// StopAll 关闭全部调试会话。
func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		_, _ = m.Stop(context.Background(), id)
	}
}

// StopByOwner 按业务会话收尾。
func (m *Manager) StopByOwner(ownerSessionID string) {
	m.mu.Lock()
	ids := make([]string, 0)
	for id, s := range m.sessions {
		if s.ownerSessionID == ownerSessionID {
			ids = append(ids, id)
		}
	}
	m.mu.Unlock()
	for _, id := range ids {
		_, _ = m.Stop(context.Background(), id)
	}
}

// attachWithRetry 在 server 挂起窗口内重试 attach。
// 固定 sleep 对「瞬间结束」的函数无效，对「启动偏慢」又可能过早失败。
func (m *Manager) attachWithRetry(ctx context.Context, ds *debugSession, nodename string, port int) (Position, error) {
	deadline := time.Now().Add(attachRetryTimeout)
	var lastErr error
	for {
		ds.mu.Lock()
		done := ds.execDone
		execErr := ds.execErr
		ds.mu.Unlock()
		if done {
			if execErr != nil {
				return Position{}, fmt.Errorf("vastbase: attach: routine failed before debugger attached: %w", execErr)
			}
			return Position{}, fmt.Errorf("%s", errAttachFinishedEarly)
		}

		ds.debugMu.Lock()
		var pos Position
		err := ds.debugConn.QueryRow(ctx,
			`SELECT funcoid, funcname, lineno, query FROM dbe_pldebugger.attach($1, $2)`,
			nodename, port,
		).Scan(&pos.FuncOID, &pos.FuncName, &pos.Line, &pos.Query)
		ds.debugMu.Unlock()
		if err == nil {
			return pos, nil
		}
		lastErr = err
		if !isRetryableAttachError(err) {
			return Position{}, fmt.Errorf("vastbase: attach: %w", err)
		}
		if time.Now().After(deadline) {
			break
		}
		select {
		case <-ctx.Done():
			return Position{}, fmt.Errorf("vastbase: attach: %w", ctx.Err())
		case <-time.After(attachRetryInterval):
		}
	}
	if lastErr != nil && isRetryableAttachError(lastErr) {
		ds.mu.Lock()
		done := ds.execDone
		ds.mu.Unlock()
		return Position{}, classifyAttachGiveUp(done, lastErr)
	}
	if lastErr != nil {
		return Position{}, fmt.Errorf("vastbase: attach: %w", lastErr)
	}
	return Position{}, fmt.Errorf("%s", errAttachFinishedEarly)
}

func classifyAttachGiveUp(execDone bool, lastErr error) error {
	if !execDone {
		if lastErr != nil {
			return fmt.Errorf("%s (last: %v)", errAttachTimeout, lastErr)
		}
		return fmt.Errorf("%s", errAttachTimeout)
	}
	return fmt.Errorf("%s", errAttachFinishedEarly)
}

func isRetryableAttachError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "D0011") ||
		strings.Contains(msg, "not running in expected way")
}

// checkRoutineDebuggable 启动前校验语言；sql 函数无法挂起，会直接 D0011。
func checkRoutineDebuggable(ctx context.Context, pool *pgxpool.Pool, oid uint32) error {
	var lang string
	err := pool.QueryRow(ctx, `
SELECT lower(l.lanname)
FROM pg_proc p
JOIN pg_language l ON l.oid = p.prolang
WHERE p.oid = $1`, oid).Scan(&lang)
	if err != nil {
		return fmt.Errorf("vastbase: resolve routine language: %w", err)
	}
	switch lang {
	case "plpgsql", "plsql":
		return nil
	case "sql":
		return fmt.Errorf(
			"vastbase: attach: ERR_ATTACH_FINISHED_EARLY (SQLSTATE D0011): " +
				"LANGUAGE sql routines cannot pause for DBE_PLDEBUGGER; rewrite as LANGUAGE plpgsql with at least one SQL statement (e.g. PERFORM 1;)",
		)
	default:
		// Vastbase 厂商语言名偶有变体：非 sql/c 时放行并由 attach 再判定
		if lang == "c" || lang == "internal" {
			return fmt.Errorf(
				"vastbase: debug: unsupported LANGUAGE %s (DBE_PLDEBUGGER requires plpgsql/plsql)",
				lang,
			)
		}
		slog.Warn("debug.language_unlisted", "lang", lang, "oid", oid)
		return nil
	}
}

func resolveOIDOnPool(ctx context.Context, pool *pgxpool.Pool, schema, name, args string) (uint32, error) {
	q := `
SELECT p.oid
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = $1 AND p.proname = $2`
	args = strings.TrimSpace(args)
	if args != "" {
		q += ` AND pg_catalog.pg_get_function_identity_arguments(p.oid) = $3 ORDER BY p.oid LIMIT 1`
		var oid uint32
		err := pool.QueryRow(ctx, q, schema, name, args).Scan(&oid)
		if err != nil {
			return 0, fmt.Errorf("vastbase: resolve routine oid: %w", err)
		}
		return oid, nil
	}
	q += ` ORDER BY p.oid LIMIT 1`
	var oid uint32
	err := pool.QueryRow(ctx, q, schema, name).Scan(&oid)
	if err != nil {
		return 0, fmt.Errorf("vastbase: resolve routine oid: %w", err)
	}
	return oid, nil
}

func buildCallSQL(kind, schema, name, callArgs string) string {
	qn := quoteIdent(schema) + "." + quoteIdent(name)
	args := strings.TrimSpace(callArgs)
	if kind == "function" {
		if args == "" {
			return "SELECT " + qn + "()"
		}
		return "SELECT " + qn + "(" + args + ")"
	}
	if args == "" {
		return "CALL " + qn + "()"
	}
	return "CALL " + qn + "(" + args + ")"
}

// buildDebugExecSQL 构造调试执行语句。
// 函数：顶层 SELECT（结束后 drain 已验证可用）。
// 过程：块内 ENABLE 后再调用；并先打一行 warmup PUT_LINE——
//       调试器下 ENABLE 后「第一次」PUT_LINE 常丢失，否则只能看到 end、看不到 start。
func buildDebugExecSQL(kind, schema, name, callArgs string) string {
	k := strings.ToLower(strings.TrimSpace(kind))
	if k == "function" {
		return buildCallSQL("function", schema, name, callArgs)
	}
	qn := quoteIdent(schema) + "." + quoteIdent(name)
	args := strings.TrimSpace(callArgs)
	invoke := qn + "()"
	if args != "" {
		invoke = qn + "(" + args + ")"
	}
	return fmt.Sprintf(`BEGIN
  DBMS_OUTPUT.ENABLE(1000000);
  DBMS_OUTPUT.PUT_LINE('nm_dbms_warmup');
  %s;
END;`, invoke)
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func turnOff(ctx context.Context, pool *pgxpool.Pool, oid uint32) error {
	if pool == nil {
		return nil
	}
	_, err := pool.Exec(ctx, `SELECT dbe_pldebugger.turn_off($1)`, oid)
	return err
}

func abortQuietConn(conn *pgxpool.Conn) error {
	if conn == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := conn.Exec(ctx, `SELECT dbe_pldebugger.abort()`)
	return err
}

func toString(v any) string {
	if v == nil {
		return ""
	}
	switch s := v.(type) {
	case string:
		return s
	case []byte:
		return string(s)
	default:
		return fmt.Sprint(s)
	}
}

func closePools(a *pgxpool.Pool, aStop func(), b *pgxpool.Pool, bStop func()) {
	if a != nil {
		a.Close()
	}
	if aStop != nil {
		aStop()
	}
	if b != nil {
		b.Close()
	}
	if bStop != nil {
		bStop()
	}
}

// combineStops 合并多个 teardown；nil 安全；同一 stop 用 sync.Once 防双关。
func combineStops(stops ...func()) func() {
	var fns []func()
	for _, s := range stops {
		if s != nil {
			fns = append(fns, s)
		}
	}
	if len(fns) == 0 {
		return nil
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			for _, s := range fns {
				s()
			}
		})
	}
}

func toInt(v any) int {
	switch n := v.(type) {
	case int32:
		return int(n)
	case int64:
		return int(n)
	case int:
		return n
	case float64:
		return int(n)
	default:
		return 0
	}
}
