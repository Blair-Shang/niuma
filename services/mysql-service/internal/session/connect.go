// Package session 管理 MySQL 连接、会话池与 SQL 查询执行。
//
// 连接参数与 Web connection_options 对齐，详见 docs/25-mysql-module.md。
// 本包不包含对象树与 catalog（后续分期）。
package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"

	"niuma/pkg/netproxy"
	"niuma/pkg/tunnel"
)

const (
	// DefaultPort 是 MySQL 默认端口。
	DefaultPort = 3306

	defaultTimeoutSeconds = 10
	defaultCharset        = "utf8mb4"
	defaultSSLMode        = "preferred"
	defaultAppName        = "niuma-mysql"
)

// ConnectOptions 与 Web connection_options JSON 对齐。
type ConnectOptions struct {
	Database              string            `json:"database"`
	Charset               string            `json:"charset"`
	Collation             string            `json:"collation"`
	SSLMode               string            `json:"ssl_mode"`
	TLSMode               string            `json:"tls"` // 兼容别名
	SSLCA                 string            `json:"ssl_ca"`
	SSLCert               string            `json:"ssl_cert"`
	SSLKey                string            `json:"ssl_key"`
	AllowNativePasswords  *bool             `json:"allowNativePasswords,omitempty"`
	ApplicationName       string            `json:"application_name"`
	ConnectTimeoutSeconds int               `json:"connect_timeout_seconds"`
	TimeoutSecondsLegacy  int               `json:"timeout_seconds"`
	ExcludeSystemSchemas  *bool             `json:"exclude_system_schemas,omitempty"`
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

// DatabaseOrEmpty 返回配置的库名；空表示不强制默认库。
func (o ConnectOptions) DatabaseOrEmpty() string {
	return strings.TrimSpace(o.Database)
}

func (o ConnectOptions) charsetOrDefault() string {
	if c := strings.TrimSpace(o.Charset); c != "" {
		return c
	}
	return defaultCharset
}

// collationOrEmpty 返回规范化后的连接排序规则；空表示仅 SET NAMES charset。
func (o ConnectOptions) collationOrEmpty() string {
	return normalizeCollation(o.charsetOrDefault(), o.Collation)
}

// isSafeMySQLName 校验 charset/collation 标识符，防止注入到 SET NAMES。
func isSafeMySQLName(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_':
		default:
			return false
		}
	}
	return true
}

// normalizeCollation 在字符集与排序规则不匹配时清空 collation（跟随字符集默认）。
func normalizeCollation(charset, collation string) string {
	coll := strings.TrimSpace(collation)
	if coll == "" {
		return ""
	}
	cs := strings.ToLower(strings.TrimSpace(charset))
	if cs == "" {
		return coll
	}
	lower := strings.ToLower(coll)
	if cs == "utf8" || cs == "utf8mb3" {
		if strings.HasPrefix(lower, "utf8_") || strings.HasPrefix(lower, "utf8mb3_") || lower == "utf8" || lower == "utf8mb3" {
			return coll
		}
		return ""
	}
	if lower == cs || strings.HasPrefix(lower, cs+"_") {
		return coll
	}
	return ""
}

func (o ConnectOptions) sslModeOrDefault() string {
	mode := strings.ToLower(strings.TrimSpace(o.SSLMode))
	if mode == "" {
		mode = strings.ToLower(strings.TrimSpace(o.TLSMode))
	}
	switch mode {
	case "", "prefer", "preferred", "allow":
		return defaultSSLMode
	case "disable", "disabled", "false":
		return "disable"
	case "require", "required", "true":
		return "require"
	case "verify-ca", "verify_ca":
		return "verify-ca"
	case "verify-full", "verify_identity", "verify-identity":
		return "verify-identity"
	default:
		return defaultSSLMode
	}
}

// effectiveTLSConfig 返回 go-sql-driver 的 TLSConfig 名。
//
// SSH 隧道已加密到目标侧；客户端实际连本机转发口。prefer/allow 在隧道下改为 disable，
// 避免本机明文口被驱动强行协商 TLS 导致失败。
func (o ConnectOptions) effectiveTLSConfig(tunnelActive bool) string {
	mode := o.sslModeOrDefault()
	if tunnelActive {
		switch mode {
		case "preferred", "prefer", "allow", "disable":
			return "false"
		}
	}
	switch mode {
	case "disable":
		return "false"
	case "preferred":
		return "preferred"
	case "require":
		return "skip-verify"
	case "verify-ca", "verify-identity":
		return "true"
	default:
		return "preferred"
	}
}

func (o ConnectOptions) allowNativePasswordsOrDefault() bool {
	if o.AllowNativePasswords == nil {
		return true
	}
	return *o.AllowNativePasswords
}

// ExcludeSystemSchemasEnabled 返回是否在对象树中隐藏系统库（默认 true）。
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

// Connect 建立 *sql.DB 连接池并 Ping 校验；返回可选的隧道 teardown。
func Connect(ctx context.Context, params ConnectParams) (*sql.DB, func(), error) {
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
			return nil, nil, fmt.Errorf("mysql: ssh tunnel: %w", err)
		}
		p.HostAddress = host
		p.PortNumber = port
		tunnelStop = stop
	}

	cfg, err := buildDriverConfig(p)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, err
	}

	connector, err := mysqldriver.NewConnector(cfg)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("mysql: connector: %w", err)
	}

	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(30 * time.Minute)

	timeout := p.Options.effectiveTimeout()
	pingCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("mysql: ping: %w", err)
	}
	return db, tunnelStop, nil
}

func buildDriverConfig(params ConnectParams) (*mysqldriver.Config, error) {
	host := strings.TrimSpace(params.HostAddress)
	if host == "" {
		return nil, fmt.Errorf("mysql: host address required")
	}

	opts := params.Options
	timeout := opts.effectiveTimeout()
	port := params.portOrDefault()
	tunnelActive := opts.Tunnel != nil && opts.Tunnel.Enabled()

	cfg := mysqldriver.NewConfig()
	cfg.User = strings.TrimSpace(params.LoginAccount)
	cfg.Passwd = params.Secret
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(host, strconv.Itoa(port))
	cfg.DBName = opts.DatabaseOrEmpty()
	cfg.Timeout = timeout
	cfg.ReadTimeout = 0
	cfg.WriteTimeout = 0
	cfg.ParseTime = true
	cfg.Loc = time.Local
	cfg.AllowNativePasswords = opts.allowNativePasswordsOrDefault()

	tlsName, tlsCustom, terr := opts.buildTLS(cfg.Addr, tunnelActive)
	if terr != nil {
		return nil, terr
	}
	if tlsCustom != nil {
		cfg.TLS = tlsCustom
	} else {
		cfg.TLSConfig = tlsName
	}

	// charset / collation 必须走驱动 Option：写入 Params 会被当成 SET 系统变量。
	// 空 collation = 仅 SET NAMES <charset>（Navicat / DBeaver 默认行为）。
	charset := opts.charsetOrDefault()
	if !isSafeMySQLName(charset) {
		return nil, fmt.Errorf("mysql: invalid charset %q", charset)
	}
	coll := opts.collationOrEmpty()
	if coll != "" && !isSafeMySQLName(coll) {
		return nil, fmt.Errorf("mysql: invalid collation %q", coll)
	}
	if err := cfg.Apply(mysqldriver.Charset(charset, coll)); err != nil {
		return nil, fmt.Errorf("mysql: charset: %w", err)
	}

	// connectionAttributes 是握手属性字段；写入 Params 会触发
	// SET connectionAttributes=...，旧版/兼容服务器会报 Error 1193。
	app := strings.TrimSpace(opts.ApplicationName)
	if app == "" {
		app = defaultAppName
	}
	cfg.ConnectionAttributes = "program_name:" + app

	// 隧道已建立时直连本地转发端口；否则可走 HTTP/SOCKS 代理拨号。
	if !tunnelActive && opts.Proxy != nil {
		dialer, derr := netproxy.ContextDialer(opts.Proxy, timeout)
		if derr != nil {
			return nil, fmt.Errorf("mysql: proxy: %w", derr)
		}
		cfg.DialFunc = func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, addr)
		}
	}

	return cfg, nil
}

// FormatHostPort 返回用于日志的 host:port 展示串。
func FormatHostPort(params ConnectParams) string {
	return net.JoinHostPort(strings.TrimSpace(params.HostAddress), strconv.Itoa(params.portOrDefault()))
}
