//go:build !windows

package serviceclient

import (
	"context"
	"net"
	"time"
)

func dialPipe(ctx context.Context, addr string) (net.Conn, error) {
	dialer := net.Dialer{Timeout: 5 * time.Second}
	return dialer.DialContext(ctx, "unix", addr)
}
