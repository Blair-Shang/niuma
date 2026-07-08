// Package netproxy 提供能力连接共用的 HTTP / SOCKS5 代理拨号。
package netproxy

import (
	"context"
	"fmt"
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
		return nil, fmt.Errorf("netproxy: unsupported type %q", scheme)
	}

	port := p.Port
	if port <= 0 {
		if scheme == "http" {
			port = 8080
		} else {
			port = 1080
		}
	}
	u := &url.URL{
		Scheme: scheme,
		Host:   fmt.Sprintf("%s:%d", p.Host, port),
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
