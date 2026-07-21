// Package streamserver 提供 Shell 原生分帧长流（语义同 InvokeStream，无 gRPC）。
package streamserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"sync"

	"niuma/pkg/serviceipc/protocol"
	"niuma/pkg/serviceipc/streamspec"
	"niuma/platform/internal/streamregistry"
)

// Server 在命名管道/UDS 上提供分帧长流服务。
type Server struct {
	addr     string
	registry *streamregistry.Registry

	mu       sync.Mutex
	sessions []*session
}

// New 创建流服务。
func New(addr string, registry *streamregistry.Registry) *Server {
	return &Server{addr: addr, registry: registry}
}

// Serve 监听并处理连接，直到 ctx 取消。
func (s *Server) Serve(ctx context.Context) error {
	ln, err := listen(s.addr)
	if err != nil {
		return err
	}
	defer ln.Close()

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	slog.Info("stream server ready", "addr", s.addr)
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go s.handleConn(ctx, conn)
	}
}

type openRequest struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	ID     string          `json:"id"`
}

type session struct {
	spec      streamspec.Spec
	bindValue string
	conn      net.Conn
	exclusive bool
}

// DeliverExclusive 将事件写入匹配的独占 stream 连接；若已投递则返回 true。
func (s *Server) DeliverExclusive(payload []byte) bool {
	s.mu.Lock()
	sessions := append([]*session(nil), s.sessions...)
	s.mu.Unlock()

	delivered := false
	for _, sess := range sessions {
		if !sess.spec.Match(payload, sess.bindValue) {
			continue
		}
		if err := protocol.WriteFrame(sess.conn, payload); err != nil {
			s.removeSession(sess)
			continue
		}
		if sess.exclusive {
			delivered = true
		}
	}
	return delivered
}

func (s *Server) handleConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	defer s.removeConnSessions(conn)

	raw, err := protocol.ReadFrame(conn)
	if err != nil {
		if !errors.Is(err, io.EOF) && ctx.Err() == nil {
			slog.Debug("stream: read open", "err", err)
		}
		return
	}

	var req openRequest
	if err := json.Unmarshal(raw, &req); err != nil || req.Method == "" {
		_ = writeError(conn, "invalid open request")
		return
	}
	spec, ok := s.registry.Get(req.Method)
	if !ok {
		_ = writeError(conn, "unknown stream method")
		return
	}
	bind, err := spec.BindValue(req.Params)
	if err != nil {
		_ = writeError(conn, err.Error())
		return
	}

	sess := &session{
		spec:      spec,
		bindValue: bind,
		conn:      conn,
		exclusive: spec.Exclusive,
	}
	s.mu.Lock()
	s.sessions = append(s.sessions, sess)
	sessionCount := len(s.sessions)
	s.mu.Unlock()

	slog.Info("stream session opened",
		"method", req.Method,
		"bind", bind,
		"sessions", sessionCount,
	)

	for {
		if _, err := protocol.ReadFrame(conn); err != nil {
			if !errors.Is(err, io.EOF) && ctx.Err() == nil {
				slog.Debug("stream: read", "err", err)
			}
			return
		}
	}
}

func (s *Server) removeConnSessions(conn net.Conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	removed := 0
	out := s.sessions[:0]
	for _, sess := range s.sessions {
		if sess.conn != conn {
			out = append(out, sess)
			continue
		}
		removed++
		slog.Info("stream session closed",
			"method", sess.spec.Method,
			"bind", sess.bindValue,
			"reason", "conn_closed",
		)
	}
	s.sessions = out
	if removed > 0 {
		slog.Debug("stream sessions after close", "removed", removed, "remaining", len(s.sessions))
	}
}

func (s *Server) removeSession(target *session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.sessions[:0]
	for _, sess := range s.sessions {
		if sess != target {
			out = append(out, sess)
			continue
		}
		slog.Info("stream session closed",
			"method", sess.spec.Method,
			"bind", sess.bindValue,
			"reason", "write_failed",
		)
	}
	s.sessions = out
	_ = target.conn.Close()
}

func writeError(conn net.Conn, msg string) error {
	payload, err := json.Marshal(map[string]any{"ok": false, "error": msg})
	if err != nil {
		return err
	}
	return protocol.WriteFrame(conn, payload)
}
