package handler

import (
	"context"
	"net"
	"time"

	"niuma/pkg/netproxy"
)

// ProxyOptions 与 Web connection_options.proxy JSON 对齐。
type ProxyOptions = netproxy.Options

func dialTCP(ctx context.Context, proxyOpts *ProxyOptions, network, address string, timeout time.Duration) (net.Conn, error) {
	conn, err := netproxy.DialContext(ctx, proxyOpts, network, address, timeout)
	if err != nil {
		return nil, err
	}
	if tcpConn, ok := conn.(*net.TCPConn); ok {
		_ = tcpConn.SetKeepAlive(true)
		_ = tcpConn.SetKeepAlivePeriod(30 * time.Second)
	}
	return conn, nil
}
