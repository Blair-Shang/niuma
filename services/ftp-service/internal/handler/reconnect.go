package handler

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"niuma/pkg/serviceipc/event"
)

const logMsgSessionRedial = "session.redial"

// isFTPConnLost 判断控制/数据连接是否已断开（含 FTP 421/426）。
func isFTPConnLost(err error) bool {
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

// ensureConnLocked 确认会话连接可用；已断开则原地重拨。调用方须持有 s.mu。
func (d *Dispatcher) ensureConnLocked(s *session) error {
	if s.conn != nil {
		if err := s.conn.NoOp(); err == nil {
			return nil
		}
	}
	return d.redialLocked(s)
}

// redialLocked 关闭旧连接（及隧道）后按建连参数重新拨号。调用方须持有 s.mu。
func (d *Dispatcher) redialLocked(s *session) error {
	if s.conn != nil {
		_ = s.conn.Quit()
		s.conn = nil
	}
	if s.tunnelStop != nil {
		s.tunnelStop()
		s.tunnelStop = nil
	}

	timeout := defaultDialTimeout
	if secs := s.params.Options.effectiveTimeoutSeconds(); secs > 0 {
		timeout = time.Duration(secs) * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	conn, stop, err := dialFTPWithTunnel(ctx, s.params)
	if err != nil {
		return err
	}
	s.conn = conn
	s.tunnelStop = stop
	slog.Info(logMsgSessionRedial, "session", s.id)
	return nil
}
