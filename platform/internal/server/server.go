// Package server 提供 Platform 的应用 IPC 服务端。
//
// 传输为面向连接的字节流（Windows 命名管道 / 其他平台 Unix Domain Socket），
// 报文分帧见 internal/protocol。每个连接由独立 goroutine 处理，连接内支持多个
// 顺序请求；多个连接天然并发。
package server

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"

	"niuma/platform/internal/protocol"
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
//
// addr 的含义随平台而定：Windows 为命名管道路径（如 \\.\pipe\niuma.platform），
// 其他平台为 Unix Domain Socket 文件路径。dispatcher 负责方法分发。
func New(addr string, dispatcher FrameDispatcher) *Server {
	return &Server{addr: addr, dispatcher: dispatcher}
}

// Addr 返回服务端监听地址。
func (s *Server) Addr() string {
	return s.addr
}

// Serve 开始监听并处理请求，直到 ctx 被取消或监听出现不可恢复错误。
//
// ctx 取消时会关闭底层监听器，使 Accept 返回并让 Serve 优雅退出。
func (s *Server) Serve(ctx context.Context) error {
	listener, err := s.listen()
	if err != nil {
		return err
	}
	defer listener.Close()

	// ctx 取消时关闭监听器，唤醒阻塞中的 Accept。
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()

	slog.Info("serving", "addr", s.addr)
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil // 正常关闭
			}
			return err
		}
		go s.handleConn(ctx, conn)
	}
}

// handleConn 在单个连接上循环读取请求帧、分发并回写响应帧。
//
// 对端正常关闭（io.EOF）时安静退出；其他读写错误记日志后结束该连接，不影响
// 其他连接与主循环。
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
