// Package session 管理 MongoDB 连接与会话生命周期。
package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.mongodb.org/mongo-driver/mongo/readpref"

	"niuma/pkg/netproxy"
	"niuma/pkg/tunnel"
)

const (
	DefaultPort           = 27017
	defaultTimeoutSeconds = 10
)

// ConnectOptions 与 Web connection_options JSON 对齐。
type ConnectOptions struct {
	Topology             string          `json:"topology"`
	AuthMechanism        string          `json:"auth_mechanism"`
	AuthDatabase         string          `json:"auth_database"`
	ReplicaSet           string          `json:"replica_set"`
	ReadPreference       string          `json:"read_preference"`
	SrvRecord            bool            `json:"srv_record"`
	TimeoutSeconds       int             `json:"timeout_seconds"`
	TimeoutSecondsLegacy int             `json:"timeoutSeconds"`
	ClientDriver         string          `json:"client_driver"`
	DefaultDatabase      string            `json:"default_database"`
	ToolPaths            map[string]string `json:"tool_paths,omitempty"`
	Proxy                *netproxy.Options `json:"proxy,omitempty"`
	Tunnel               *tunnel.Options   `json:"tunnel,omitempty"`
}

func (o ConnectOptions) effectiveTimeout() time.Duration {
	secs := o.TimeoutSeconds
	if secs <= 0 {
		secs = o.TimeoutSecondsLegacy
	}
	if secs <= 0 {
		secs = defaultTimeoutSeconds
	}
	return time.Duration(secs) * time.Second
}

// ConnectParams 是建连参数（含明文凭据，仅进程内使用）。
type ConnectParams struct {
	HostAddress  string         `json:"hostAddress"`
	PortNumber   int            `json:"portNumber"`
	LoginAccount string         `json:"loginAccount"`
	Secret       string         `json:"secret"`
	Options      ConnectOptions `json:"options"`
}

// UnmarshalJSON 兼容历史 `password` 字段。
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

// Connect 建立 MongoDB 客户端并 Ping 校验；返回可选的隧道 teardown 函数。
func Connect(ctx context.Context, params ConnectParams) (*mongo.Client, func(), error) {
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
			return nil, nil, fmt.Errorf("mongodb: ssh tunnel: %w", err)
		}
		p.HostAddress = host
		p.PortNumber = port
		tunnelStop = stop
	}

	uri, err := buildURI(p)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, err
	}

	timeout := p.Options.effectiveTimeout()
	clientOpts := options.Client().ApplyURI(uri)
	clientOpts.SetConnectTimeout(timeout)
	clientOpts.SetServerSelectionTimeout(timeout)

	if p.Options.ClientDriver != "legacy" {
		clientOpts.SetServerAPIOptions(options.ServerAPI(options.ServerAPIVersion1))
	}
	if rp := readPrefFromString(p.Options.ReadPreference); rp != nil {
		clientOpts.SetReadPreference(rp)
	}

	// 隧道已建立时直连本地转发端口；否则可走 HTTP/SOCKS 代理拨号。
	if tunnelStop == nil && p.Options.Proxy != nil {
		dialer, derr := netproxy.ContextDialer(p.Options.Proxy, timeout)
		if derr != nil {
			return nil, nil, fmt.Errorf("mongodb: proxy: %w", derr)
		}
		clientOpts.SetDialer(dialer)
	}

	client, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("mongodb: connect: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		if tunnelStop != nil {
			tunnelStop()
		}
		return nil, nil, fmt.Errorf("mongodb: ping: %w", err)
	}
	return client, tunnelStop, nil
}

func buildURI(params ConnectParams) (string, error) {
	host := strings.TrimSpace(params.HostAddress)
	if host == "" {
		return "", fmt.Errorf("host address required")
	}

	opts := params.Options
	scheme := "mongodb"
	if opts.SrvRecord {
		scheme = "mongodb+srv"
	}

	var hostPart string
	if opts.SrvRecord {
		hostPart = host
	} else {
		hostPart = net.JoinHostPort(host, strconv.Itoa(params.portOrDefault()))
	}

	u := &url.URL{
		Scheme: scheme,
		Host:   hostPart,
		Path:   "/",
	}
	if account := strings.TrimSpace(params.LoginAccount); account != "" {
		if params.Secret != "" {
			u.User = url.UserPassword(account, params.Secret)
		} else {
			u.User = url.User(account)
		}
	}

	q := u.Query()
	authDB := strings.TrimSpace(opts.AuthDatabase)
	if authDB == "" && u.User != nil {
		authDB = "admin"
	}
	if authDB != "" {
		q.Set("authSource", authDB)
	}
	if rs := strings.TrimSpace(opts.ReplicaSet); rs != "" {
		q.Set("replicaSet", rs)
	}
	if mech := mapAuthMechanism(opts.AuthMechanism); mech != "" {
		q.Set("authMechanism", mech)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func mapAuthMechanism(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "default", "scram":
		return ""
	case "x509":
		return "MONGODB-X509"
	case "ldap":
		return "PLAIN"
	case "kerberos":
		return "GSSAPI"
	default:
		return raw
	}
}

func readPrefFromString(raw string) *readpref.ReadPref {
	switch strings.TrimSpace(raw) {
	case "", "primary":
		return readpref.Primary()
	case "primaryPreferred":
		return readpref.PrimaryPreferred()
	case "secondary":
		return readpref.Secondary()
	case "secondaryPreferred":
		return readpref.SecondaryPreferred()
	case "nearest":
		return readpref.Nearest()
	default:
		return nil
	}
}
