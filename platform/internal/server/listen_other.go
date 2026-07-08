//go:build !windows

package server

import (
	"fmt"
	"net"
	"os"
)

// listen 在非 Windows 平台创建 Unix Domain Socket 监听器。
//
// 先移除可能残留的旧 socket 文件，避免 "address already in use"。
func (s *Server) listen() (net.Listener, error) {
	_ = os.Remove(s.addr)
	listener, err := net.Listen("unix", s.addr)
	if err != nil {
		return nil, fmt.Errorf("server: listen unix %s: %w", s.addr, err)
	}
	return listener, nil
}
