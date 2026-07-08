// Package server 提供能力服务的应用 IPC 服务端（命名管道 / UDS）。
package server

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"

	"niuma/pkg/serviceipc/protocol"
)

// FrameDispatcher 处理一帧请求 JSON 并返回响应 JSON 字节。
type FrameDispatcher interface {
	HandleFrame(ctx context.Context, raw []byte) []byte
}

// Server 在给定地址上监听应用 IPC 请求并分发给 handler。
type Server struct {
	addr       string
	dispatcher FrameDispatcher
}

// New 创建监听 addr 的 Server。
func New(addr string, dispatcher FrameDispatcher) *Server {
	return &Server{addr: addr, dispatcher: dispatcher}
}

// Serve 开始监听并处理请求，直到 ctx 被取消。
func (s *Server) Serve(ctx context.Context) error {
	listener, err := s.listen()
	if err != nil {
		return err
	}
	defer listener.Close()

	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()

	slog.Info("serving", "addr", s.addr)
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		go s.handleConn(ctx, conn)
	}
}

func (s *Server) handleConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	for {
		payload, err := protocol.ReadFrame(conn)
		if err != nil {
			if !errors.Is(err, io.EOF) && ctx.Err() == nil {
				slog.Error("read frame", "err", err)
			}
			return
		}

		resp := s.dispatcher.HandleFrame(ctx, payload)
		if err := protocol.WriteFrame(conn, resp); err != nil {
			slog.Error("write frame", "err", err)
			return
		}
	}
}
