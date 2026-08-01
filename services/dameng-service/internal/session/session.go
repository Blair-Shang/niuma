// Package session owns Dameng database connections, execution, cursors and transactions.
package session

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "gitee.com/chunanyong/dm"
	"niuma/pkg/common/id"
	"niuma/pkg/common/sqlcell"
	"niuma/pkg/netproxy"
	"niuma/pkg/tunnel"
	"niuma/services/dameng-service/internal/dialect"
)

const (
	DefaultPort       = 5236
	defaultAppName    = "NiuMa"
	DefaultQueryLimit = 1000
	MaxQueryLimit     = 10000
)

type ConnectOptions struct {
	Schema                string            `json:"schema"`
	Database              string            `json:"database"`
	ApplicationName       string            `json:"application_name"`
	AppName               string            `json:"appName"`
	ConnectTimeoutSeconds int               `json:"connect_timeout_seconds"`
	SSLMode               string            `json:"ssl_mode"`
	SSLCA                 string            `json:"ssl_ca"`
	SSLCert               string            `json:"ssl_cert"`
	SSLKey                string            `json:"ssl_key"`
	ExcludeSystemSchemas  *bool             `json:"exclude_system_schemas,omitempty"`
	Proxy                 *netproxy.Options `json:"proxy,omitempty"`
	Tunnel                *tunnel.Options   `json:"tunnel,omitempty"`
}

func (o ConnectOptions) appNameOrDefault() string {
	if s := strings.TrimSpace(o.ApplicationName); s != "" {
		return s
	}
	if s := strings.TrimSpace(o.AppName); s != "" {
		return s
	}
	return defaultAppName
}

func (o ConnectOptions) SchemaOrEmpty() string {
	if s := strings.TrimSpace(o.Schema); s != "" {
		return s
	}
	return strings.TrimSpace(o.Database)
}
func (o ConnectOptions) ExcludeSystemSchemasEnabled() bool {
	return o.ExcludeSystemSchemas == nil || *o.ExcludeSystemSchemas
}
func (o ConnectOptions) timeout() time.Duration {
	if o.ConnectTimeoutSeconds > 0 {
		return time.Duration(o.ConnectTimeoutSeconds) * time.Second
	}
	return 30 * time.Second
}

type ConnectParams struct {
	HostAddress  string         `json:"hostAddress"`
	PortNumber   int            `json:"portNumber"`
	LoginAccount string         `json:"loginAccount"`
	Secret       string         `json:"secret"`
	Options      ConnectOptions `json:"options"`
}

func (p *ConnectParams) UnmarshalJSON(data []byte) error {
	type plain ConnectParams
	var v struct {
		plain
		Password string `json:"password"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	*p = ConnectParams(v.plain)
	if p.Secret == "" {
		p.Secret = v.Password
	}
	return nil
}
func (p ConnectParams) port() int {
	if p.PortNumber > 0 {
		return p.PortNumber
	}
	return DefaultPort
}
func buildDSN(p ConnectParams) (string, error) {
	host := strings.TrimSpace(p.HostAddress)
	if host == "" {
		return "", fmt.Errorf("dameng: host address required")
	}
	// dm 驱动 parseDSN 按字符串切割 user:pass@host，不会 QueryUnescape。
	// url.UserPassword 会把 ?, ) 等编成 %XX，驱动把字面量当密码 → Error -2501。
	// 用户名/密码保持原样写入；始终带 query，保证 LastIndex('?') 落在参数分隔符上。
	user := strings.TrimSpace(p.LoginAccount)
	pass := p.Secret
	hostPort := net.JoinHostPort(host, strconv.Itoa(p.port()))
	q := url.Values{}
	if schema := p.Options.SchemaOrEmpty(); schema != "" {
		q.Set("schema", schema)
	}
	q.Set("appName", p.Options.appNameOrDefault())
	q.Set("connectTimeout", strconv.FormatInt(p.Options.timeout().Milliseconds(), 10))
	if mode := strings.ToLower(strings.TrimSpace(p.Options.SSLMode)); mode == "require" || mode == "verify" || mode == "verify-ca" || mode == "verify-full" {
		if ca := strings.TrimSpace(p.Options.SSLCA); ca != "" {
			q.Set("sslFilesPath", ca)
		}
	}
	var b strings.Builder
	b.Grow(len(user) + len(pass) + len(hostPort) + 64)
	b.WriteString("dm://")
	b.WriteString(user)
	b.WriteByte(':')
	b.WriteString(pass)
	b.WriteByte('@')
	b.WriteString(hostPort)
	b.WriteByte('?')
	b.WriteString(q.Encode())
	return b.String(), nil
}
func proxyEnabled(o *netproxy.Options) bool {
	if o == nil {
		return false
	}
	t := o.Type
	return t != "" && t != "none" && o.Host != ""
}

func Connect(ctx context.Context, p ConnectParams) (*sql.DB, func(), error) {
	if proxyEnabled(p.Options.Proxy) && (p.Options.Tunnel == nil || !p.Options.Tunnel.Enabled()) {
		return nil, nil, fmt.Errorf("dameng: proxy dialer not supported with dm DSN; use SSH tunnel")
	}
	var stop func()
	var err error
	if p.Options.Tunnel != nil && p.Options.Tunnel.Enabled() {
		var host string
		var port int
		host, port, stop, err = tunnel.StartSSHTunnel(ctx, p.Options.Tunnel, p.HostAddress, p.port())
		if err != nil {
			return nil, nil, fmt.Errorf("dameng: ssh tunnel: %w", err)
		}
		p.HostAddress = host
		p.PortNumber = port
	}
	dsn, err := buildDSN(p)
	if err != nil {
		if stop != nil {
			stop()
		}
		return nil, nil, err
	}
	db, err := sql.Open("dm", dsn)
	if err != nil {
		if stop != nil {
			stop()
		}
		return nil, nil, fmt.Errorf("dameng: open: %w", err)
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(2)
	c, cancel := context.WithTimeout(ctx, p.Options.timeout())
	defer cancel()
	if err = db.PingContext(c); err != nil {
		_ = db.Close()
		if stop != nil {
			stop()
		}
		return nil, nil, fmt.Errorf("dameng: ping: %w", err)
	}
	return db, stop, nil
}
func ProbeVersion(ctx context.Context, db *sql.DB) (string, error) {
	p, err := dialect.Probe(ctx, db)
	if err != nil {
		return "", err
	}
	return p.Version, nil
}

type ColumnMeta struct {
	Name      string `json:"name"`
	DataType  string `json:"dataType,omitempty"`
	Nullable  *bool  `json:"nullable,omitempty"`
	Length    *int64 `json:"length,omitempty"`
	Precision *int64 `json:"precision,omitempty"`
	Scale     *int64 `json:"scale,omitempty"`
}
type QueryExecParams struct {
	SessionID string `json:"sessionId"`
	Schema    string `json:"schema,omitempty"`
	Database  string `json:"database,omitempty"`
	SQL       string `json:"sql"`
	Limit     int    `json:"limit"`
	TimeoutMS int    `json:"timeoutMs"`
	RequestID string `json:"requestId"`
}

func (p QueryExecParams) SchemaOrEmpty() string {
	if s := strings.TrimSpace(p.Schema); s != "" {
		return s
	}
	return strings.TrimSpace(p.Database)
}

type QueryExecResult struct {
	RequestID    string       `json:"requestId"`
	ResultSetID  string       `json:"resultSetId,omitempty"`
	Columns      []ColumnMeta `json:"columns"`
	Rows         [][]any      `json:"rows"`
	RowCount     int          `json:"rowCount"`
	FetchedCount int          `json:"fetchedCount,omitempty"`
	HasMore      bool         `json:"hasMore,omitempty"`
	Truncated    bool         `json:"truncated,omitempty"`
	DurationMS   int64        `json:"durationMs"`
	CommandTag   string       `json:"commandTag,omitempty"`
	RowsAffected *int64       `json:"rowsAffected,omitempty"`
}
type QueryFetchParams struct {
	SessionID   string `json:"sessionId"`
	ResultSetID string `json:"resultSetId"`
	Limit       int    `json:"limit"`
}
type QueryCloseParams struct {
	SessionID   string `json:"sessionId"`
	ResultSetID string `json:"resultSetId,omitempty"`
}
type QueryFetchResult struct {
	ResultSetID  string  `json:"resultSetId,omitempty"`
	Rows         [][]any `json:"rows"`
	RowCount     int     `json:"rowCount"`
	FetchedCount int     `json:"fetchedCount"`
	HasMore      bool    `json:"hasMore"`
	Truncated    bool    `json:"truncated,omitempty"`
	DurationMS   int64   `json:"durationMs"`
	CommandTag   string  `json:"commandTag,omitempty"`
}

func queryLimit(n int) int {
	if n <= 0 {
		return DefaultQueryLimit
	}
	if n > MaxQueryLimit {
		return MaxQueryLimit
	}
	return n
}
func ptr(n int64) *int64 { return &n }
func metas(rows *sql.Rows) ([]ColumnMeta, error) {
	names, e := rows.Columns()
	if e != nil {
		return nil, fmt.Errorf("dameng: columns: %w", e)
	}
	ts, _ := rows.ColumnTypes()
	out := make([]ColumnMeta, len(names))
	for i, n := range names {
		out[i].Name = n
		if i < len(ts) && ts[i] != nil {
			out[i].DataType = ts[i].DatabaseTypeName()
			if v, ok := ts[i].Nullable(); ok {
				out[i].Nullable = &v
			}
			if v, ok := ts[i].Length(); ok {
				out[i].Length = &v
			}
			if p, s, ok := ts[i].DecimalSize(); ok {
				out[i].Precision = &p
				out[i].Scale = &s
			}
		}
	}
	return out, nil
}
func cell(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case []byte:
		return sqlcell.EncodeBytesAsTextOrBinary(x)
	case time.Time:
		return x.Format("2006-01-02 15:04:05.999999")
	case int64:
		if x > 9007199254740991 || x < -9007199254740991 {
			return strconv.FormatInt(x, 10)
		}
		return x
	case uint64:
		if x > 9007199254740991 {
			return strconv.FormatUint(x, 10)
		}
		return x
	default:
		return x
	}
}
func scan(rows *sql.Rows, n int) ([]any, error) {
	v := make([]any, n)
	d := make([]any, n)
	for i := range v {
		d[i] = &v[i]
	}
	if e := rows.Scan(d...); e != nil {
		return nil, fmt.Errorf("dameng: scan: %w", e)
	}
	for i := range v {
		v[i] = cell(v[i])
	}
	return v, nil
}

type ResultSet struct {
	ID, RequestID, SessionID string
	rows                     *sql.Rows
	conn                     *sql.Conn
	columns                  []ColumnMeta
	peek                     []any
	fetched                  int
	commandTag               string
	closed                   bool
	mu                       sync.Mutex
	cancel                   context.CancelFunc
	releaseOwned             func()
	sessionOwned             bool
	onReleaseTx              func()
}
type queryCancel struct{ cancel context.CancelFunc }
type Session struct {
	ID         string
	DB         *sql.DB
	Params     ConnectParams
	TunnelStop func()
	Dialect    *dialect.ServerProfile
	mu         sync.Mutex
	inflight   map[string]*queryCancel
	resultSets map[string]*ResultSet
	autoCommit bool
	inTx       bool
	txConn     *sql.Conn
	txBusy     bool
	txSchema   string
}

func NewSession(id string, db *sql.DB, p ConnectParams, stop func(), profile *dialect.ServerProfile) *Session {
	return &Session{ID: id, DB: db, Params: p, TunnelStop: stop, Dialect: profile, autoCommit: true, inflight: map[string]*queryCancel{}, resultSets: map[string]*ResultSet{}}
}
func (s *Session) RegisterQuery(parent context.Context, id string) (context.Context, func()) {
	c, cancel := context.WithCancel(parent)
	e := &queryCancel{cancel}
	s.mu.Lock()
	s.inflight[id] = e
	s.mu.Unlock()
	return c, func() { s.mu.Lock(); delete(s.inflight, id); s.mu.Unlock(); cancel() }
}
func (s *Session) CancelQuery(id string) int {
	n := 0
	s.mu.Lock()
	var toClose []*ResultSet
	for rsID, rs := range s.resultSets {
		if id == "" || rs.RequestID == id {
			toClose = append(toClose, rs)
			delete(s.resultSets, rsID)
		}
	}
	var es []*queryCancel
	for k, e := range s.inflight {
		if id == "" || id == k {
			es = append(es, e)
			delete(s.inflight, k)
		}
	}
	s.mu.Unlock()
	for _, rs := range toClose {
		rs.forceClose()
		n++
	}
	for _, e := range es {
		e.cancel()
		n++
	}
	return n
}
func (s *Session) Close() {
	s.CloseResultSet("")
	s.CancelQuery("")
	s.mu.Lock()
	conn := s.txConn
	s.txConn = nil
	s.autoCommit = true
	s.inTx = false
	s.txBusy = false
	s.txSchema = ""
	s.mu.Unlock()
	if conn != nil {
		// 归还连接前恢复驱动层 autoCommit，避免污染连接池。
		_ = driverRollback(conn)
		_ = conn.Close()
	}
	if s.DB != nil {
		_ = s.DB.Close()
	}
	if s.TunnelStop != nil {
		s.TunnelStop()
	}
}
func (s *Session) IsAutoCommit() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.autoCommit || s.txConn == nil
}

func ExecOnDB(ctx context.Context, db *sql.DB, q string, limit int, request string) (*QueryExecResult, error) {
	return execute(ctx, db, q, limit, request)
}
func execute(ctx context.Context, db *sql.DB, q string, limit int, request string) (*QueryExecResult, error) {
	q = strings.TrimSpace(q)
	if q == "" {
		return nil, fmt.Errorf("dameng: sql required")
	}
	request = id.CoalesceID(request, "q")
	start := time.Now()
	if !returnsRows(q) {
		r, e := db.ExecContext(ctx, q)
		if e != nil {
			return nil, fmt.Errorf("dameng: exec: %w", e)
		}
		n, _ := r.RowsAffected()
		return &QueryExecResult{RequestID: request, DurationMS: time.Since(start).Milliseconds(), CommandTag: tag(q), RowsAffected: ptr(n)}, nil
	}
	rows, e := db.QueryContext(ctx, q)
	if e != nil {
		return nil, fmt.Errorf("dameng: query: %w", e)
	}
	defer rows.Close()
	cols, e := metas(rows)
	if e != nil {
		return nil, e
	}
	if len(cols) == 0 {
		return &QueryExecResult{RequestID: request, DurationMS: time.Since(start).Milliseconds(), CommandTag: tag(q), RowsAffected: ptr(0)}, nil
	}
	out := [][]any{}
	for len(out) < queryLimit(limit) && rows.Next() {
		v, e := scan(rows, len(cols))
		if e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	if e := rows.Err(); e != nil {
		return nil, fmt.Errorf("dameng: rows: %w", e)
	}
	tr := len(out) >= queryLimit(limit) && rows.Next()
	return &QueryExecResult{RequestID: request, Columns: cols, Rows: out, RowCount: len(out), FetchedCount: len(out), Truncated: tr, DurationMS: time.Since(start).Milliseconds(), CommandTag: tag(q)}, nil
}
func (s *Session) ensureConnSchema(ctx context.Context, conn *sql.Conn, sessionOwned bool, schema string) error {
	schema = strings.TrimSpace(schema)
	if schema == "" || conn == nil {
		return nil
	}
	if sessionOwned {
		s.mu.Lock()
		current := s.txSchema
		s.mu.Unlock()
		if strings.EqualFold(current, schema) {
			return nil
		}
	}
	q := `ALTER SESSION SET CURRENT_SCHEMA = "` + strings.ReplaceAll(schema, `"`, `""`) + `"`
	if _, e := conn.ExecContext(ctx, q); e != nil {
		return fmt.Errorf("dameng: set current schema: %w", e)
	}
	if sessionOwned {
		s.mu.Lock()
		s.txSchema = schema
		s.mu.Unlock()
	}
	return nil
}

func (s *Session) markInTxAfterStatement() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.autoCommit && s.txConn != nil {
		s.inTx = true
	}
}

func (s *Session) acquireExecConn(ctx context.Context, db *sql.DB) (conn *sql.Conn, sessionOwned bool, releaseTx func(), err error) {
	s.mu.Lock()
	useTx := !s.autoCommit && s.txConn != nil
	if useTx {
		if s.txBusy {
			s.mu.Unlock()
			return nil, false, nil, fmt.Errorf("dameng: transaction connection busy (close open result cursor first)")
		}
		conn = s.txConn
		s.txBusy = true
		s.mu.Unlock()
		return conn, true, func() {
			s.mu.Lock()
			s.txBusy = false
			s.mu.Unlock()
		}, nil
	}
	s.mu.Unlock()
	if db == nil {
		return nil, false, nil, fmt.Errorf("dameng: db required")
	}
	conn, err = db.Conn(ctx)
	if err != nil {
		return nil, false, nil, fmt.Errorf("dameng: acquire: %w", err)
	}
	return conn, false, nil, nil
}

type TxState struct {
	AutoCommit    bool `json:"autoCommit"`
	InTransaction bool `json:"inTransaction"`
}

func (s *Session) TxStateSnapshot() TxState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return TxState{AutoCommit: s.autoCommit || s.txConn == nil, InTransaction: s.inTx}
}

// SetAutoCommit 切换 Auto-commit。
// 注意：达梦 SET AUTOCOMMIT ON/OFF 仅 DISQL 客户端命令，不能当服务端 SQL 执行；
// 关闭时钉住连接并通过驱动 Begin 关闭驱动层 autoCommit（对齐 JDBC setAutoCommit）。
func (s *Session) SetAutoCommit(ctx context.Context, enabled bool) (TxState, error) {
	if s.DB == nil {
		return TxState{}, fmt.Errorf("dameng: session closed")
	}
	s.CloseResultSet("")
	s.mu.Lock()
	busy := s.txBusy
	s.mu.Unlock()
	if busy {
		return TxState{}, fmt.Errorf("dameng: transaction connection busy")
	}
	if enabled {
		return s.ensureAutoCommitOn(ctx)
	}
	return s.ensureAutoCommitOff(ctx)
}

func (s *Session) ensureAutoCommitOn(ctx context.Context) (TxState, error) {
	s.mu.Lock()
	conn := s.txConn
	inTx := s.inTx
	s.mu.Unlock()

	if conn != nil {
		if inTx {
			if err := driverRollback(conn); err != nil {
				return TxState{}, fmt.Errorf("dameng: rollback before auto-commit: %w", err)
			}
		} else {
			// 即使无未提交语句，也走驱动 Rollback 以恢复 autoCommit=true，避免污染连接池。
			_ = driverRollback(conn)
		}
		_ = conn.Close()
	}

	s.mu.Lock()
	s.txConn = nil
	s.autoCommit = true
	s.inTx = false
	s.txBusy = false
	s.txSchema = ""
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

func (s *Session) ensureAutoCommitOff(ctx context.Context) (TxState, error) {
	s.mu.Lock()
	if s.txConn != nil {
		s.autoCommit = false
		s.mu.Unlock()
		return s.TxStateSnapshot(), nil
	}
	s.mu.Unlock()

	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return TxState{}, fmt.Errorf("dameng: acquire tx conn: %w", err)
	}
	if err := beginDriverManualTx(conn); err != nil {
		_ = conn.Close()
		return TxState{}, err
	}

	s.mu.Lock()
	s.txConn = conn
	s.autoCommit = false
	s.inTx = false
	s.txBusy = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

func (s *Session) Commit(ctx context.Context) (TxState, error) {
	s.CloseResultSet("")
	s.mu.Lock()
	conn := s.txConn
	busy := s.txBusy
	auto := s.autoCommit || conn == nil
	s.mu.Unlock()
	if auto {
		return TxState{AutoCommit: true}, fmt.Errorf("dameng: auto-commit is on; nothing to commit")
	}
	if busy {
		return TxState{}, fmt.Errorf("dameng: transaction connection busy")
	}
	if err := driverCommit(conn); err != nil {
		return TxState{}, fmt.Errorf("dameng: commit: %w", err)
	}
	// 驱动 Commit 会把 autoCommit 恢复为默认 true，需重新进入手动模式。
	if err := beginDriverManualTx(conn); err != nil {
		return TxState{}, fmt.Errorf("dameng: begin after commit: %w", err)
	}
	s.mu.Lock()
	s.inTx = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

func (s *Session) Rollback(ctx context.Context) (TxState, error) {
	s.CloseResultSet("")
	s.mu.Lock()
	conn := s.txConn
	busy := s.txBusy
	auto := s.autoCommit || conn == nil
	s.mu.Unlock()
	if auto {
		return TxState{AutoCommit: true}, fmt.Errorf("dameng: auto-commit is on; nothing to rollback")
	}
	if busy {
		return TxState{}, fmt.Errorf("dameng: transaction connection busy")
	}
	if err := driverRollback(conn); err != nil {
		return TxState{}, fmt.Errorf("dameng: rollback: %w", err)
	}
	if err := beginDriverManualTx(conn); err != nil {
		return TxState{}, fmt.Errorf("dameng: begin after rollback: %w", err)
	}
	s.mu.Lock()
	s.inTx = false
	s.mu.Unlock()
	return s.TxStateSnapshot(), nil
}

// beginDriverManualTx 通过驱动 Begin 关闭连接级 autoCommit（等价 JDBC setAutoCommit(false)）。
func beginDriverManualTx(conn *sql.Conn) error {
	if conn == nil {
		return fmt.Errorf("dameng: nil conn")
	}
	return conn.Raw(func(driverConn any) error {
		if b, ok := driverConn.(driver.ConnBeginTx); ok {
			_, err := b.BeginTx(context.Background(), driver.TxOptions{})
			return err
		}
		if b, ok := driverConn.(interface {
			Begin() (driver.Tx, error)
		}); ok {
			_, err := b.Begin()
			return err
		}
		return fmt.Errorf("dameng: driver does not support begin")
	})
}

func driverCommit(conn *sql.Conn) error {
	if conn == nil {
		return fmt.Errorf("dameng: nil conn")
	}
	return conn.Raw(func(driverConn any) error {
		if c, ok := driverConn.(interface{ Commit() error }); ok {
			return c.Commit()
		}
		return fmt.Errorf("dameng: driver does not support commit")
	})
}

func driverRollback(conn *sql.Conn) error {
	if conn == nil {
		return fmt.Errorf("dameng: nil conn")
	}
	return conn.Raw(func(driverConn any) error {
		if r, ok := driverConn.(interface{ Rollback() error }); ok {
			return r.Rollback()
		}
		return fmt.Errorf("dameng: driver does not support rollback")
	})
}
