//go:build windows

package serviceclient

import (
	"context"
	"fmt"
	"net"
	"time"

	"github.com/Microsoft/go-winio"
)

func dialPipe(ctx context.Context, addr string) (net.Conn, error) {
	timeout := 2 * time.Second
	deadline := time.Now().Add(5 * time.Second)
	step := 50 * time.Millisecond
	var lastErr error
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		conn, err := winio.DialPipe(addr, &timeout)
		if err == nil {
			return conn, nil
		}
		lastErr = err
		time.Sleep(step)
	}
	return nil, fmt.Errorf("pipe not ready: %w", lastErr)
}
