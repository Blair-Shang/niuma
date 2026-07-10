// Package netproxy 提供能力连接共用的 HTTP / SOCKS 代理拨号。
package netproxy

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/url"
	"time"

	"golang.org/x/net/proxy"
)

// Options 与 Web connection_options.proxy JSON 对齐。
type Options struct {
	Type     string `json:"type"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func (p *Options) enabled() bool {
	if p == nil {
		return false
	}
	t := p.Type
	if t == "" || t == "none" {
		return false
	}
	return p.Host != ""
}

// ContextDialer 返回经代理（或直连）的拨号器。
func ContextDialer(p *Options, timeout time.Duration) (proxy.ContextDialer, error) {
	base := &net.Dialer{Timeout: timeout}
	if !p.enabled() {
		return base, nil
	}

	scheme := p.Type
	switch scheme {
	case "http", "socks5":
	default:
		if scheme == "socks4" || scheme == "socks4a" {
			return &socks4Dialer{
				base:      base,
				proxyAddr: fmt.Sprintf("%s:%d", p.Host, proxyPort(scheme, p.Port)),
				username:  p.Username,
				remoteDNS: scheme == "socks4a",
			}, nil
		}
		return nil, fmt.Errorf("netproxy: unsupported type %q", scheme)
	}

	u := &url.URL{
		Scheme: scheme,
		Host:   fmt.Sprintf("%s:%d", p.Host, proxyPort(scheme, p.Port)),
	}
	if p.Username != "" {
		u.User = url.UserPassword(p.Username, p.Password)
	}
	d, err := proxy.FromURL(u, base)
	if err != nil {
		return nil, fmt.Errorf("netproxy: %s: %w", scheme, err)
	}
	cd, ok := d.(proxy.ContextDialer)
	if !ok {
		return nil, fmt.Errorf("netproxy: dialer does not support context")
	}
	return cd, nil
}

// DialContext 建立 TCP 连接（经代理或直连）。
func DialContext(ctx context.Context, p *Options, network, address string, timeout time.Duration) (net.Conn, error) {
	d, err := ContextDialer(p, timeout)
	if err != nil {
		return nil, err
	}
	return d.DialContext(ctx, network, address)
}

func proxyPort(scheme string, port int) int {
	if port > 0 {
		return port
	}
	if scheme == "http" {
		return 8080
	}
	return 1080
}

type socks4Dialer struct {
	base      *net.Dialer
	proxyAddr string
	username  string
	remoteDNS bool
}

func (d *socks4Dialer) Dial(network, address string) (net.Conn, error) {
	return d.DialContext(context.Background(), network, address)
}

func (d *socks4Dialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	if network != "tcp" && network != "tcp4" && network != "tcp6" {
		return nil, fmt.Errorf("netproxy: socks4 only supports tcp, got %q", network)
	}
	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("netproxy: socks4 target address: %w", err)
	}
	port, err := net.LookupPort("tcp", portText)
	if err != nil {
		return nil, fmt.Errorf("netproxy: socks4 target port: %w", err)
	}
	conn, err := d.base.DialContext(ctx, "tcp", d.proxyAddr)
	if err != nil {
		return nil, err
	}
	if err := d.handshake(ctx, conn, host, port); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return conn, nil
}

func (d *socks4Dialer) handshake(ctx context.Context, conn net.Conn, host string, port int) error {
	if deadline, ok := ctx.Deadline(); ok {
		if err := conn.SetDeadline(deadline); err != nil {
			return err
		}
		defer func() { _ = conn.SetDeadline(time.Time{}) }()
	}
	targetIP, err := d.socks4IP(ctx, host)
	if err != nil {
		return err
	}
	req := []byte{0x04, 0x01, byte(port >> 8), byte(port)}
	req = append(req, targetIP...)
	req = append(req, []byte(d.username)...)
	req = append(req, 0)
	if d.remoteDNS {
		req = append(req, []byte(host)...)
		req = append(req, 0)
	}
	if _, err := conn.Write(req); err != nil {
		return err
	}
	resp := make([]byte, 8)
	if _, err := io.ReadFull(conn, resp); err != nil {
		return err
	}
	if resp[1] != 0x5a {
		return fmt.Errorf("netproxy: socks4 connect failed: %d", resp[1])
	}
	return nil
}

func (d *socks4Dialer) socks4IP(ctx context.Context, host string) ([]byte, error) {
	if d.remoteDNS {
		return []byte{0, 0, 0, 1}, nil
	}
	if ip := net.ParseIP(host).To4(); ip != nil {
		return ip, nil
	}
	resolver := net.DefaultResolver
	addrs, err := resolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	for _, addr := range addrs {
		if ip := addr.IP.To4(); ip != nil {
			return ip, nil
		}
	}
	return nil, fmt.Errorf("netproxy: socks4 requires an IPv4 target; use socks4a for remote DNS")
}
