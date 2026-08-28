package transfer

import (
	"context"
	"log/slog"
	"strings"

	"niuma/pkg/serviceipc/event"

	"github.com/jlaffaye/ftp"
)

const logMsgTransferReconnect = "transfer.reconnect"

const maxTransferReconnects = 2

// ConnLease 是持有会话锁期间的连接租约，支持原地重拨且保持 sessionId 不变。
type ConnLease struct {
	Conn *ftp.ServerConn
	// Reconnect 在当前锁内原地重拨，成功后更新 Conn。
	Reconnect func() (*ftp.ServerConn, error)
	// Release 释放会话锁，传输结束后必须调用。
	Release func()
}

func isConnLost(err error) bool {
	if event.IsConnLost(err) {
		return true
	}
	if err == nil {
		return false
	}
	m := strings.ToLower(err.Error())
	return strings.Contains(m, "421") ||
		strings.Contains(m, "426") ||
		strings.Contains(m, "idle timeout") ||
		strings.Contains(m, "closing control") ||
		strings.Contains(m, "not connected") ||
		strings.Contains(m, "connection was aborted") ||
		strings.Contains(m, "operation was canceled") ||
		strings.Contains(m, "operation was cancelled")
}

// retryVoid 在连接断开时原地重拨并重试无返回值操作。
func retryVoid(ctx context.Context, lease *ConnLease, fn func() error) error {
	_, err := retryOnConnLost(ctx, lease, func() (struct{}, error) {
		return struct{}{}, fn()
	})
	return err
}

// retryOnConnLost 在连接断开时原地重拨并整段重试 fn（不续传偏移）。
func retryOnConnLost[T any](ctx context.Context, lease *ConnLease, fn func() (T, error)) (T, error) {
	var zero T
	var lastErr error
	for attempt := 0; attempt <= maxTransferReconnects; attempt++ {
		if err := ctx.Err(); err != nil {
			return zero, err
		}
		v, err := fn()
		if err == nil {
			return v, nil
		}
		lastErr = err
		if !isConnLost(err) || lease == nil || lease.Reconnect == nil || attempt == maxTransferReconnects {
			return zero, err
		}
		conn, recErr := lease.Reconnect()
		if recErr != nil {
			return zero, err
		}
		lease.Conn = conn
		slog.Info(logMsgTransferReconnect, "attempt", attempt+1)
	}
	return zero, lastErr
}
