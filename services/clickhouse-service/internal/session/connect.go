// Package session 管理 ClickHouse 连接、会话池与 SQL 查询执行。
//
// 连接参数与 Web connection_options 对齐，详见 docs/30-clickhouse-module.md。
// 本服务不提供传统多语句事务 API（ClickHouse 无对应模型）。
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

	"github.com/ClickHouse/clickhouse-go/v2"

	"niuma/pkg/netproxy"
	"niuma/pkg/tunnel"
)

// 传输协议（字符串枚举，禁止 iota）。
const (
	// ProtocolNative 表示 ClickHouse Native TCP（默认）。
	ProtocolNative = "native"
	// ProtocolHTTP 表示 HTTP 传输（LB / Cloud 常用）。
	ProtocolHTTP = "http"
)

const (
	// DefaultNativePort 是 Native 协议默认端口。
	DefaultNativePort = 9000
	// DefaultHTTPPort 是 HTTP 协议默认端口。
	DefaultHTTPPort = 8123
	// DefaultNativeTLSPort 是 Native TLS 默认端口。
	DefaultNativeTLSPort = 9440
	// DefaultHTTPTLSPort 是 HTTPS 默认端口。
	DefaultHTTPTLSPort = 8443

	defaultTimeoutSeconds = 10
	defaultDatabase       = "default"
	defaultAppName        = "niuma-clickhouse"

	maxOpenConns = 8
	maxIdleConns = 2
	connMaxLife  = 30 * time.Minute
)

// ConnectOptions 与 Web connection_options JSON 对齐。
type ConnectOptions struct {
	Database              string `json:"database"`
	Protocol              string `json:"protocol"`
	Secure                *bool  `json:"secure,omitempty"`
	TLS                   *bool  `json:"tls,omitempty"` // 兼容别名
	SSLMode               string `json:"ssl_mode"`
	SSLCA                 string `json:"ssl_ca"`
	SSLCert               string `json:"ssl_cert"`
	SSLKey                string `json:"ssl_key"`
	Compress              *bool  `json:"compress,omitempty"`
	ApplicationName       string `json:"application_name"`
	ConnectTimeoutSeconds int    `json:"connect_timeout_seconds"`
	ReadTimeoutSeconds    int    `json:"read_timeout_seconds"`
	ExcludeSystemDBs      *bool  `json:"exclude_system_databases,omitempty"`
	Cluster               string `json:"cluster"`
	// AltHosts 备用节点，逗号/分号/空白分隔；每项为 host 或 host:port（无端口用主端口）。
	// 与主地址一并写入驱动 Addr，按序 failover（ConnOpenInOrder）。SSH 隧道启用时忽略。
	AltHosts string            `json:"alt_hosts,omitempty"`
	Proxy    *netproxy.Options `json:"proxy,omitempty"`
	Tunnel   *tunnel.Options   `json:"tunnel,omitempty"`
}

// ProtocolOrDefault 返回规范化协议名。
func (o ConnectOptions) ProtocolOrDefault() string {
	switch strings.ToLower(strings.TrimSpace(o.Protocol)) {
	case ProtocolHTTP, "https":
		return ProtocolHTTP
	default:
		return ProtocolNative
	}
}

// DatabaseOrDefault 返回默认库名。
func (o ConnectOptions) DatabaseOrDefault() string {
	if db := strings.TrimSpace(o.Database); db != "" {
		return db
	}
	return defaultDatabase
}

// ExcludeSystemDatabasesEnabled 返回是否在对象树中隐藏系统库（默认 true）。
func (o ConnectOptions) ExcludeSystemDatabasesEnabled() bool {
	if o.ExcludeSystemDBs == nil {
		return true
	}
	return *o.ExcludeSystemDBs
}

func (o ConnectOptions) effectiveTimeout() time.Duration {
	secs := o.ConnectTimeoutSeconds
	if secs <= 0 {
		secs = defaultTimeoutSeconds
	}
	return time.Duration(secs) * time.Second
}

func (o ConnectOptions) effectiveReadTimeout() time.Duration {
	if o.ReadTimeoutSeconds > 0 {
		return time.Duration(o.ReadTimeoutSeconds) * time.Second
	}
	return 0
}

func (o ConnectOptions) secureEnabled() bool {
	if o.Secure != nil {
		return *o.Secure
	}
	if o.TLS != nil {
		return *o.TLS
	}
	mode := strings.ToLower(strings.TrimSpace(o.SSLMode))
	switch mode {
	case "require", "required", "verify-ca", "verify_ca", "verify-full", "verify_identity", "verify-identity", "true":
		return true
	default:
		return false
	}
}

func (o ConnectOptions) compressEnabled() bool {
	if o.Compress == nil {
		return true
	}
	return *o.Compress
}

func (o ConnectOptions) appNameOrDefault() string {
	if s := strings.TrimSpace(o.ApplicationName); s != "" {
		return s
	}
	return defaultAppName
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

// PortOrDefault 按协议与 TLS 返回默认端口。
func (p ConnectParams) PortOrDefault() int {
	if p.PortNumber > 0 {
		return p.PortNumber
	}
	secure := p.Options.secureEnabled()
	switch p.Options.ProtocolOrDefault() {
	case ProtocolHTTP:
		if secure {
			return DefaultHTTPTLSPort
		}
		return DefaultHTTPPort
	default:
		if secure {
			return DefaultNativeTLSPort
		}
		return DefaultNativePort
	}
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
			p.PortOrDefault(),
		)
		if err != nil {
			return nil, nil, fmt.Errorf("clickhouse: ssh tunnel: %w", err)
		}
		p.HostAddress = host
		p.PortNumber = port
		tunnelStop = stop
	}

	opts, err := buildDriverOptions(p)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, err
	}

	db := clickhouse.OpenDB(opts)
	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxLifetime(connMaxLife)

	timeout := p.Options.effectiveTimeout()
	pingCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("clickhouse: ping: %w", err)
	}
	return db, tunnelStop, nil
}

// ConnectNative 建立 clickhouse.Conn（PrepareBatch / 原生 bulk INSERT）；返回 teardown。
func ConnectNative(ctx context.Context, params ConnectParams) (clickhouse.Conn, func(), error) {
	p := params
	var tunnelStop func()

	if p.Options.Tunnel != nil && p.Options.Tunnel.Enabled() {
		host, port, stop, err := tunnel.StartSSHTunnel(
			ctx,
			p.Options.Tunnel,
			p.HostAddress,
			p.PortOrDefault(),
		)
		if err != nil {
			return nil, nil, fmt.Errorf("clickhouse: ssh tunnel: %w", err)
		}
		p.HostAddress = host
		p.PortNumber = port
		tunnelStop = stop
	}

	opts, err := buildDriverOptions(p)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, err
	}

	conn, err := clickhouse.Open(opts)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("clickhouse: open native: %w", err)
	}

	timeout := p.Options.effectiveTimeout()
	pingCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := conn.Ping(pingCtx); err != nil {
		_ = conn.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("clickhouse: ping: %w", err)
	}

	stop := func() {
		_ = conn.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
	}
	return conn, stop, nil
}

func buildDriverOptions(params ConnectParams) (*clickhouse.Options, error) {
	addrs, err := collectAddrs(params)
	if err != nil {
		return nil, err
	}
	primaryHost, _, _ := net.SplitHostPort(addrs[0])
	opts := params.Options
	timeout := opts.effectiveTimeout()
	tunnelActive := opts.Tunnel != nil && opts.Tunnel.Enabled()

	protocol := clickhouse.Native
	if opts.ProtocolOrDefault() == ProtocolHTTP {
		protocol = clickhouse.HTTP
	}

	o := &clickhouse.Options{
		Addr: addrs,
		Auth: clickhouse.Auth{
			Database: opts.DatabaseOrDefault(),
			Username: strings.TrimSpace(params.LoginAccount),
			Password: params.Secret,
		},
		ClientInfo: clickhouse.ClientInfo{
			Products: []struct {
				Name    string
				Version string
			}{
				{Name: opts.appNameOrDefault(), Version: "1"},
			},
		},
		DialTimeout:      timeout,
		ConnOpenStrategy: clickhouse.ConnOpenInOrder,
		Protocol:         protocol,
	}
	if readTO := opts.effectiveReadTimeout(); readTO > 0 {
		o.ReadTimeout = readTO
	}
	if opts.compressEnabled() {
		o.Compression = &clickhouse.Compression{Method: clickhouse.CompressionLZ4}
	}
	if opts.secureEnabled() {
		tlsCfg, err := buildTLSConfig(opts, primaryHost)
		if err != nil {
			return nil, err
		}
		o.TLS = tlsCfg
	}

	// 隧道已建立时直连本地转发端口；否则可走 HTTP/SOCKS 代理拨号。
	// DialContext 必须使用驱动传入的 addr，以便多节点 failover 生效。
	if !tunnelActive && opts.Proxy != nil {
		dialer, derr := netproxy.ContextDialer(opts.Proxy, timeout)
		if derr != nil {
			return nil, fmt.Errorf("clickhouse: proxy: %w", derr)
		}
		o.DialContext = func(ctx context.Context, addr string) (net.Conn, error) {
			return dialer.DialContext(ctx, "tcp", addr)
		}
	}
	return o, nil
}

// collectAddrs 组装驱动 Addr：主地址 + alt_hosts；隧道模式下仅主地址（本地转发）。
func collectAddrs(params ConnectParams) ([]string, error) {
	port := params.PortOrDefault()
	primary := strings.TrimSpace(params.HostAddress)
	if primary == "" {
		return nil, fmt.Errorf("clickhouse: host address required")
	}
	addrs, err := parseHostPortList(primary, port)
	if err != nil {
		return nil, err
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("clickhouse: host address required")
	}

	tunnelActive := params.Options.Tunnel != nil && params.Options.Tunnel.Enabled()
	if tunnelActive {
		// SSH 隧道只转发主节点，忽略备用列表。
		return addrs[:1], nil
	}

	alts, err := parseHostPortList(params.Options.AltHosts, port)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: alt_hosts: %w", err)
	}
	return dedupeAddrs(append(addrs, alts...)), nil
}

// parseHostPortList 解析逗号/分号/空白分隔的 host 或 host:port 列表。
func parseHostPortList(raw string, defaultPort int) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if defaultPort <= 0 {
		return nil, fmt.Errorf("invalid default port")
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ';' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	})
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		host, port, err := splitHostPortDefault(part, defaultPort)
		if err != nil {
			return nil, err
		}
		if host == "" {
			return nil, fmt.Errorf("empty host in %q", part)
		}
		if strings.ContainsAny(host, "/\\") {
			return nil, fmt.Errorf("invalid host %q", host)
		}
		out = append(out, net.JoinHostPort(host, strconv.Itoa(port)))
	}
	return out, nil
}

func splitHostPortDefault(item string, defaultPort int) (host string, port int, err error) {
	item = strings.TrimSpace(item)
	// IPv6：[::1]:9000 或裸 ::1
	if strings.HasPrefix(item, "[") {
		h, p, e := net.SplitHostPort(item)
		if e != nil {
			// 允许 "[::1]" 无端口
			if strings.HasSuffix(item, "]") {
				return item[1 : len(item)-1], defaultPort, nil
			}
			return "", 0, fmt.Errorf("invalid address %q: %w", item, e)
		}
		portNum, pe := strconv.Atoi(p)
		if pe != nil || portNum <= 0 || portNum > 65535 {
			return "", 0, fmt.Errorf("invalid port in %q", item)
		}
		return h, portNum, nil
	}
	if h, p, e := net.SplitHostPort(item); e == nil {
		portNum, pe := strconv.Atoi(p)
		if pe != nil || portNum <= 0 || portNum > 65535 {
			return "", 0, fmt.Errorf("invalid port in %q", item)
		}
		return h, portNum, nil
	}
	// 无端口：hostname / IPv4 / 裸 IPv6（不含括号时无法与 port 区分，要求用户写 [::1]）
	if strings.Count(item, ":") > 0 && net.ParseIP(item) == nil {
		return "", 0, fmt.Errorf("invalid address %q (use host:port or [ipv6]:port)", item)
	}
	return item, defaultPort, nil
}

func dedupeAddrs(addrs []string) []string {
	seen := make(map[string]struct{}, len(addrs))
	out := make([]string, 0, len(addrs))
	for _, a := range addrs {
		if _, ok := seen[a]; ok {
			continue
		}
		seen[a] = struct{}{}
		out = append(out, a)
	}
	return out
}

// FormatHostPort 返回用于日志的 host:port 展示串（含备用节点）。
func FormatHostPort(params ConnectParams) string {
	addrs, err := collectAddrs(params)
	if err != nil || len(addrs) == 0 {
		return net.JoinHostPort(strings.TrimSpace(params.HostAddress), strconv.Itoa(params.PortOrDefault()))
	}
	return strings.Join(addrs, ",")
}

// QuoteIdent 使用反引号转义标识符，防止 USE / DDL 注入。
func QuoteIdent(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("clickhouse: empty identifier")
	}
	if strings.ContainsRune(name, 0) {
		return "", fmt.Errorf("clickhouse: identifier contains NUL")
	}
	return "`" + strings.ReplaceAll(name, "`", "``") + "`", nil
}

// IsSafeDatabaseName 校验库名是否可安全用于 USE（字母数字下划线点）。
func IsSafeDatabaseName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_' || r == '.':
		default:
			return false
		}
	}
	return true
}
