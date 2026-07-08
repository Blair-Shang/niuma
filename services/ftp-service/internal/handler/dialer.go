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
	return netproxy.DialContext(ctx, proxyOpts, network, address, timeout)
}
