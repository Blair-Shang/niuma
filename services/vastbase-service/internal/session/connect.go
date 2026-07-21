// Package session 管理 Vastbase（PG 线协议）连接、会话池与 SQL 查询执行。
//
// 连接参数与 Web connection_options 对齐，详见 docs/22-vastbase-module.md §4。
// 本包不包含对象树（见 tree）与存储过程调试（见 debug）。
package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"niuma/pkg/netproxy"
	"niuma/pkg/tunnel"
)

const (
	// DefaultPort 是 Vastbase / PostgreSQL 默认端口。
	DefaultPort = 5432

	defaultTimeoutSeconds = 10
	defaultDatabase       = "postgres"
	defaultSSLMode        = "prefer"
	defaultAppName        = "niuma-vastbase"
)

// ConnectOptions 与 Web connection_options JSON 对齐。
type ConnectOptions struct {
	Database              string            `json:"database"`
	SSLMode               string            `json:"ssl_mode"`
	SSLRootCert           string            `json:"ssl_root_cert"`
	SSLCert               string            `json:"ssl_cert"`
	SSLKey                string            `json:"ssl_key"`
	SearchPath            string            `json:"search_path"`
	ClientEncoding        string            `json:"client_encoding"`
	ApplicationName       string            `json:"application_name"`
	ConnectTimeoutSeconds int               `json:"connect_timeout_seconds"`
	StatementTimeoutMS    int               `json:"statement_timeout_ms"`
	ExcludeSystemSchemas  *bool             `json:"exclude_system_schemas,omitempty"`
	TimeoutSecondsLegacy  int               `json:"timeout_seconds"` // 兼容通用字段
	Proxy                 *netproxy.Options `json:"proxy,omitempty"`
	Tunnel                *tunnel.Options   `json:"tunnel,omitempty"`
}

func (o ConnectOptions) effectiveTimeout() time.Duration {
	secs := o.ConnectTimeoutSeconds
	if secs <= 0 {
		secs = o.TimeoutSecondsLegacy
	}
	if secs <= 0 {
		secs = defaultTimeoutSeconds
	}
	return time.Duration(secs) * time.Second
}

// DatabaseOrDefault 返回配置的库名；空则回退到 postgres。
func (o ConnectOptions) DatabaseOrDefault() string {
	if db := strings.TrimSpace(o.Database); db != "" {
		return db
	}
	return defaultDatabase
}

func (o ConnectOptions) sslModeOrDefault() string {
	mode := strings.ToLower(strings.TrimSpace(o.SSLMode))
	switch mode {
	case "", "prefer":
		return defaultSSLMode
	case "disable", "allow", "require", "verify-ca", "verify-full":
		return mode
	default:
		return defaultSSLMode
	}
}

// effectiveSSLMode 返回写入 DSN 的 sslmode。
//
// SSH 隧道已加密到目标侧；客户端实际连的是本机转发口。此时若仍用 prefer/allow，
// pgx 会先发 SSLRequest，Vastbase / openGauss 等明文口常直接 RST，出现
// “tls error … connection was forcibly closed”。隧道场景下将 prefer/allow 降为 disable；
// 用户显式 require / verify-ca / verify-full（远端强制 TLS）仍尊重。
func (o ConnectOptions) effectiveSSLMode(tunnelActive bool) string {
	mode := o.sslModeOrDefault()
	if !tunnelActive {
		return mode
	}
	switch mode {
	case "prefer", "allow":
		return "disable"
	default:
		return mode
	}
}

func (o ConnectOptions) applicationNameOrDefault() string {
	if name := strings.TrimSpace(o.ApplicationName); name != "" {
		return name
	}
	return defaultAppName
}

// clientEncodingOrEmpty 返回可写入 DSN 的 client_encoding；空则不设置。
func (o ConnectOptions) clientEncodingOrEmpty() string {
	enc := strings.TrimSpace(o.ClientEncoding)
	if enc == "" {
		return ""
	}
	for _, r := range enc {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_':
		default:
			return ""
		}
	}
	return enc
}

// ExcludeSystemSchemasEnabled 返回是否在对象树中隐藏系统 schema（默认 true）。
func (o ConnectOptions) ExcludeSystemSchemasEnabled() bool {
	if o.ExcludeSystemSchemas == nil {
		return true
	}
	return *o.ExcludeSystemSchemas
}

// ConnectParams 是建连参数（含明文凭据，仅进程内使用）。
type ConnectParams struct {
	HostAddress  string         `json:"hostAddress"`
	PortNumber   int            `json:"portNumber"`
	LoginAccount string         `json:"loginAccount"`
	Secret       string         `json:"secret"`
	Options      ConnectOptions `json:"options"`
}

// UnmarshalJSON 兼容历史 password 字段。
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

func (p ConnectParams) portOrDefault() int {
	if p.PortNumber <= 0 {
		return DefaultPort
	}
	return p.PortNumber
}

// PrepareDialParams 若启用 SSH 隧道则只启一次，并把 Host/Port 改写为本地转发口；
// 同时清空 Options.Tunnel，避免二次 Connect* 再开隧道。返回的 stop 关闭该共享隧道。
// 本地转发场景下 prefer/allow 降为 disable（与 effectiveSSLMode 在隧道开启时一致）。
func PrepareDialParams(ctx context.Context, params ConnectParams) (ConnectParams, func(), error) {
	p := params
	if p.Options.Tunnel == nil || !p.Options.Tunnel.Enabled() {
		return p, nil, nil
	}
	host, port, stop, err := tunnel.StartSSHTunnel(
		ctx,
		p.Options.Tunnel,
		p.HostAddress,
		p.portOrDefault(),
	)
	if err != nil {
		return ConnectParams{}, nil, fmt.Errorf("vastbase: ssh tunnel: %w", err)
	}
	p.HostAddress = host
	p.PortNumber = port
	p.Options.Tunnel = nil
	switch p.Options.sslModeOrDefault() {
	case "prefer", "allow":
		p.Options.SSLMode = "disable"
	}
	return p, stop, nil
}

// Connect 建立 pgx 连接池并 Ping 校验；返回可选的隧道 teardown。
func Connect(ctx context.Context, params ConnectParams) (*pgxpool.Pool, func(), error) {
	p := params
	var tunnelStop func()

	if p.Options.Tunnel != nil && p.Options.Tunnel.Enabled() {
		host, port, stop, err := tunnel.StartSSHTunnel(
			ctx,
			p.Options.Tunnel,
			p.HostAddress,
			p.portOrDefault(),
		)
		if err != nil {
			return nil, nil, fmt.Errorf("vastbase: ssh tunnel: %w", err)
		}
		p.HostAddress = host
		p.PortNumber = port
		tunnelStop = stop
	}

	cfg, err := buildPoolConfig(p)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, err
	}

	timeout := p.Options.effectiveTimeout()
	dialCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(dialCtx, cfg)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("vastbase: connect: %w", err)
	}

	pingCtx, pingCancel := context.WithTimeout(ctx, timeout)
	defer pingCancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("vastbase: ping: %w", err)
	}
	return pool, tunnelStop, nil
}

// ConnectExclusive 建立 MaxConns=1 的专用池（PL 调试双连接 / 长挂起 CALL 用）。
func ConnectExclusive(ctx context.Context, params ConnectParams) (*pgxpool.Pool, func(), error) {
	return ConnectExclusiveWithNotice(ctx, params, nil)
}

// ConnectExclusiveWithNotice 同 ConnectExclusive，并可挂接 NOTICE 回调（调试 DBMS_OUTPUT 回显）。
func ConnectExclusiveWithNotice(
	ctx context.Context,
	params ConnectParams,
	onNotice func(*pgconn.PgConn, *pgconn.Notice),
) (*pgxpool.Pool, func(), error) {
	p := params
	var tunnelStop func()

	if p.Options.Tunnel != nil && p.Options.Tunnel.Enabled() {
		host, port, stop, err := tunnel.StartSSHTunnel(
			ctx,
			p.Options.Tunnel,
			p.HostAddress,
			p.portOrDefault(),
		)
		if err != nil {
			return nil, nil, fmt.Errorf("vastbase: ssh tunnel: %w", err)
		}
		p.HostAddress = host
		p.PortNumber = port
		tunnelStop = stop
	}

	cfg, err := buildPoolConfig(p)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, err
	}
	cfg.MaxConns = 1
	cfg.MinConns = 0
	if onNotice != nil {
		cfg.ConnConfig.OnNotice = onNotice
	}
	// 调试挂起不受语句超时限制
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		searchPath := strings.TrimSpace(p.Options.SearchPath)
		if searchPath != "" {
			if _, err := conn.Exec(ctx, "SELECT set_config('search_path', $1, false)", searchPath); err != nil {
				return fmt.Errorf("vastbase: set search_path: %w", err)
			}
		}
		if _, err := conn.Exec(ctx, "SET statement_timeout = 0"); err != nil {
			return fmt.Errorf("vastbase: clear statement_timeout: %w", err)
		}
		return nil
	}

	timeout := p.Options.effectiveTimeout()
	dialCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(dialCtx, cfg)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("vastbase: connect exclusive: %w", err)
	}

	pingCtx, pingCancel := context.WithTimeout(ctx, timeout)
	defer pingCancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("vastbase: ping exclusive: %w", err)
	}
	return pool, tunnelStop, nil
}

func buildPoolConfig(params ConnectParams) (*pgxpool.Config, error) {
	host := strings.TrimSpace(params.HostAddress)
	if host == "" {
		return nil, fmt.Errorf("vastbase: host address required")
	}

	opts := params.Options
	timeout := opts.effectiveTimeout()
	port := params.portOrDefault()
	dbName := opts.DatabaseOrDefault()
	tunnelActive := opts.Tunnel != nil && opts.Tunnel.Enabled()

	dsn := fmt.Sprintf(
		"host=%s port=%d dbname=%s sslmode=%s connect_timeout=%d application_name=%s",
		quoteConnValue(host),
		port,
		quoteConnValue(dbName),
		quoteConnValue(opts.effectiveSSLMode(tunnelActive)),
		int(timeout.Seconds()),
		quoteConnValue(opts.applicationNameOrDefault()),
	)
	if account := strings.TrimSpace(params.LoginAccount); account != "" {
		dsn += " user=" + quoteConnValue(account)
	}
	if params.Secret != "" {
		dsn += " password=" + quoteConnValue(params.Secret)
	}
	if root := strings.TrimSpace(opts.SSLRootCert); root != "" {
		dsn += " sslrootcert=" + quoteConnValue(root)
	}
	if cert := strings.TrimSpace(opts.SSLCert); cert != "" {
		dsn += " sslcert=" + quoteConnValue(cert)
	}
	if key := strings.TrimSpace(opts.SSLKey); key != "" {
		dsn += " sslkey=" + quoteConnValue(key)
	}
	if enc := opts.clientEncodingOrEmpty(); enc != "" {
		dsn += " client_encoding=" + quoteConnValue(enc)
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("vastbase: parse config: %w", err)
	}

	cfg.MaxConns = 8
	cfg.MinConns = 0
	cfg.ConnConfig.ConnectTimeout = timeout

	searchPath := strings.TrimSpace(opts.SearchPath)
	statementTimeoutMS := opts.StatementTimeoutMS
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		if searchPath != "" {
			if _, err := conn.Exec(ctx, "SELECT set_config('search_path', $1, false)", searchPath); err != nil {
				return fmt.Errorf("vastbase: set search_path: %w", err)
			}
		}
		if statementTimeoutMS > 0 {
			if _, err := conn.Exec(ctx, fmt.Sprintf("SET statement_timeout = %d", statementTimeoutMS)); err != nil {
				return fmt.Errorf("vastbase: set statement_timeout: %w", err)
			}
		}
		return nil
	}

	// 隧道已建立时直连本地转发端口；否则可走 HTTP/SOCKS 代理拨号。
	if params.Options.Tunnel == nil || !params.Options.Tunnel.Enabled() {
		if params.Options.Proxy != nil {
			dialer, derr := netproxy.ContextDialer(params.Options.Proxy, timeout)
			if derr != nil {
				return nil, fmt.Errorf("vastbase: proxy: %w", derr)
			}
			cfg.ConnConfig.DialFunc = func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.DialContext(ctx, network, addr)
			}
		}
	}

	return cfg, nil
}

// quoteConnValue 将 libpq 关键字/值安全写入 DSN（含空格与引号时加引号）。
func quoteConnValue(v string) string {
	if v == "" {
		return "''"
	}
	needQuote := false
	for _, r := range v {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\'' || r == '\\' || r == '=' {
			needQuote = true
			break
		}
	}
	if !needQuote {
		return v
	}
	var b strings.Builder
	b.WriteByte('\'')
	for _, r := range v {
		if r == '\\' || r == '\'' {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	b.WriteByte('\'')
	return b.String()
}

// FormatHostPort 返回用于日志的 host:port 展示串。
func FormatHostPort(params ConnectParams) string {
	return net.JoinHostPort(strings.TrimSpace(params.HostAddress), strconv.Itoa(params.portOrDefault()))
}
