package handler

import (
	"log/slog"
	"time"
)

const defaultKeepaliveSeconds = 60

// effectiveKeepaliveSeconds 返回 FTP NOOP 保活间隔秒数；0 表示禁用。
func (o ConnectOptions) effectiveKeepaliveSeconds() int {
	if o.KeepaliveSeconds > 0 {
		return o.KeepaliveSeconds
	}
	return 0
}

// startSessionKeepalive 在后台周期性发送 FTP NOOP，避免空闲被 NAT/服务端断开。
func startSessionKeepalive(s *session, keepaliveSeconds int) {
	if keepaliveSeconds <= 0 {
		return
	}
	interval := time.Duration(keepaliveSeconds) * time.Second
	stop := make(chan struct{})
	s.keepaliveStop = stop
	go runSessionKeepalive(s, interval, stop)
}

func runSessionKeepalive(s *session, interval time.Duration, stop <-chan struct{}) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			if err := noopSession(s); err != nil {
				slog.Warn("keepalive", "session", s.id, "err", err)
			}
		}
	}
}

// noopSession 发送 NOOP；传输占用锁时跳过本轮，避免阻塞文件传输。
func noopSession(s *session) error {
	if !s.mu.TryLock() {
		return nil
	}
	defer s.mu.Unlock()
	if s.conn == nil {
		return nil
	}
	return s.conn.NoOp()
}

func stopSessionKeepalive(s *session) {
	if s.keepaliveStop == nil {
		return
	}
	close(s.keepaliveStop)
	s.keepaliveStop = nil
}
