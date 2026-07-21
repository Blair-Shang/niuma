//go:build !windows

package client

import (
	"context"
	"net"
	"time"
)

func dialAddr(ctx context.Context, addr string) (net.Conn, error) {
	dialer := net.Dialer{Timeout: 5 * time.Second}
	return dialer.DialContext(ctx, "unix", addr)
}
