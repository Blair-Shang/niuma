// Package session 管理 SQL Server 连接、会话池与 T-SQL 查询执行。
//
// 连接参数与 Web connection_options 对齐，详见 docs/32-sqlserver-module.md。
package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	mssql "github.com/microsoft/go-mssqldb"

	"niuma/pkg/netproxy"
	"niuma/pkg/tunnel"
)

const (
	// DefaultPort 是 SQL Server 默认端口。
	DefaultPort = 1433

	defaultTimeoutSeconds = 10
	defaultAppName        = "NiuMa"
	defaultEncrypt        = "optional"
	defaultAuthType       = "sql"

	maxOpenConns = 8
	maxIdleConns = 2
	connMaxLife  = 30 * time.Minute
)

// ConnectOptions 与 Web connection_options JSON 对齐（协议字段 snake_case）。
type ConnectOptions struct {
	Database                string `json:"database"`
	Instance                string `json:"instance"`
	AuthType                string `json:"auth_type"`
	Encrypt                 string `json:"encrypt"`
	TrustServerCertificate  *bool  `json:"trust_server_certificate,omitempty"`
	HostNameInCertificate   string `json:"host_name_in_certificate"`
	ApplicationName         string `json:"application_name"`
	ConnectTimeoutSeconds   int    `json:"connect_timeout_seconds"`
	TimeoutSecondsLegacy    int    `json:"timeout_seconds"`
	ExcludeSystemSchemas    *bool  `json:"exclude_system_schemas,omitempty"`
	Proxy                   *netproxy.Options `json:"proxy,omitempty"`
	Tunnel                  *tunnel.Options   `json:"tunnel,omitempty"`
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

// InstanceOrEmpty 返回命名实例名。
func (o ConnectOptions) InstanceOrEmpty() string {
	return strings.TrimSpace(o.Instance)
}

func (o ConnectOptions) authTypeOrDefault() string {
	t := strings.ToLower(strings.TrimSpace(o.AuthType))
	if t == "" {
		return defaultAuthType
	}
	return t
}

func (o ConnectOptions) encryptOrDefault() string {
	mode := strings.ToLower(strings.TrimSpace(o.Encrypt))
	switch mode {
	case "", "prefer", "preferred", "optional", "false":
		return "optional"
	case "disable", "disabled", "off":
		return "disable"
	case "require", "required", "mandatory", "true", "strict":
		if mode == "strict" {
			return "strict"
		}
		return "mandatory"
	default:
		return defaultEncrypt
	}
}

func (o ConnectOptions) trustServerCertificate() bool {
	if o.TrustServerCertificate == nil {
		return false
	}
	return *o.TrustServerCertificate
}

func (o ConnectOptions) appNameOrDefault() string {
	if s := strings.TrimSpace(o.ApplicationName); s != "" {
		return s
	}
	return defaultAppName
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

// PortOrDefault 返回端口；命名实例且未指定端口时仍回退 1433（驱动可走 Browser）。
func (p ConnectParams) PortOrDefault() int {
	if p.PortNumber > 0 {
		return p.PortNumber
	}
	return DefaultPort
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
			return nil, nil, fmt.Errorf("sqlserver: ssh tunnel: %w", err)
		}
		p.HostAddress = host
		p.PortNumber = port
		// 隧道已到固定端口，清除命名实例以免再走 SQL Browser。
		p.Options.Instance = ""
		tunnelStop = stop
	}

	if err := validateAuth(p); err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, err
	}

	dsn, err := buildDSN(p)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, err
	}

	connector, err := mssql.NewConnector(dsn)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("sqlserver: connector: %w", err)
	}

	tunnelActive := p.Options.Tunnel != nil && p.Options.Tunnel.Enabled()
	timeout := p.Options.effectiveTimeout()
	if !tunnelActive && p.Options.Proxy != nil {
		dialer, derr := netproxy.ContextDialer(p.Options.Proxy, timeout)
		if derr != nil {
			if tunnelStop != nil {
				tunnelStop()
			}
			return nil, nil, fmt.Errorf("sqlserver: proxy: %w", derr)
		}
		connector.Dialer = dialContextAdapter{d: dialer}
	}

	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxIdleConns)
	db.SetConnMaxLifetime(connMaxLife)

	pingCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("sqlserver: ping: %w", err)
	}
	return db, tunnelStop, nil
}

type dialContextAdapter struct {
	d interface {
		DialContext(ctx context.Context, network, address string) (net.Conn, error)
	}
}

func (a dialContextAdapter) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return a.d.DialContext(ctx, network, address)
}

func validateAuth(params ConnectParams) error {
	switch params.Options.authTypeOrDefault() {
	case "sql":
		if strings.TrimSpace(params.LoginAccount) == "" {
			return fmt.Errorf("sqlserver: login account required for sql auth")
		}
		return nil
	case "windows", "aad_password", "aad_integrated", "aad_msi", "aad_service_principal":
		return fmt.Errorf("sqlserver: auth_type %q is not implemented in P0; use sql auth", params.Options.authTypeOrDefault())
	default:
		return fmt.Errorf("sqlserver: unsupported auth_type %q", params.Options.AuthType)
	}
}

func buildDSN(params ConnectParams) (string, error) {
	host := strings.TrimSpace(params.HostAddress)
	if host == "" {
		return "", fmt.Errorf("sqlserver: host address required")
	}

	q := url.Values{}
	if db := params.Options.DatabaseOrEmpty(); db != "" {
		q.Set("database", db)
	}
	q.Set("encrypt", mapEncryptQuery(params.Options.encryptOrDefault()))
	if params.Options.trustServerCertificate() {
		q.Set("TrustServerCertificate", "true")
	}
	if hn := strings.TrimSpace(params.Options.HostNameInCertificate); hn != "" {
		q.Set("hostNameInCertificate", hn)
	}
	q.Set("app name", params.Options.appNameOrDefault())
	timeoutSecs := int(params.Options.effectiveTimeout().Seconds())
	if timeoutSecs < 1 {
		timeoutSecs = defaultTimeoutSeconds
	}
	q.Set("dial timeout", strconv.Itoa(timeoutSecs))

	u := &url.URL{
		Scheme:   "sqlserver",
		User:     url.UserPassword(strings.TrimSpace(params.LoginAccount), params.Secret),
		RawQuery: q.Encode(),
	}

	instance := params.Options.InstanceOrEmpty()
	if instance != "" && params.PortNumber <= 0 {
		// 命名实例：sqlserver://user:pass@host/instance?...
		u.Host = host
		u.Path = "/" + instance
	} else {
		u.Host = net.JoinHostPort(host, strconv.Itoa(params.PortOrDefault()))
		if instance != "" {
			// 显式端口优先；仍保留 instance 查询参数供驱动参考。
			q.Set("instance", instance)
			u.RawQuery = q.Encode()
		}
	}
	return u.String(), nil
}

func mapEncryptQuery(mode string) string {
	switch mode {
	case "disable":
		return "disable"
	case "mandatory":
		return "true"
	case "strict":
		return "strict"
	default: // optional
		return "false"
	}
}

// QuoteIdent 用方括号引用标识符（] → ]]）。
func QuoteIdent(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("sqlserver: empty identifier")
	}
	if strings.ContainsRune(name, 0) {
		return "", fmt.Errorf("sqlserver: identifier contains NUL")
	}
	return "[" + strings.ReplaceAll(name, "]", "]]") + "]", nil
}

// IsSafeDatabaseName 校验库名不含控制字符（最终仍经 QuoteIdent）。
func IsSafeDatabaseName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

// FormatHostPort 返回用于日志的 host:port 展示串。
func FormatHostPort(params ConnectParams) string {
	host := strings.TrimSpace(params.HostAddress)
	if inst := params.Options.InstanceOrEmpty(); inst != "" && params.PortNumber <= 0 {
		return host + `\` + inst
	}
	return net.JoinHostPort(host, strconv.Itoa(params.PortOrDefault()))
}
