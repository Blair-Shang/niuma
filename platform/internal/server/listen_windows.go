//go:build windows

package server

import (
	"fmt"
	"net"

	"github.com/Microsoft/go-winio"
)

// listen 在 Windows 上创建命名管道监听器。
//
// 采用默认安全描述符（仅当前用户可访问的本机管道），不监听网络端口。
func (s *Server) listen() (net.Listener, error) {
	listener, err := winio.ListenPipe(s.addr, &winio.PipeConfig{
		// 单帧上限与 protocol.MaxFrameSize 对齐即可；管道缓冲区取一个合理值。
		InputBufferSize:  64 * 1024,
		OutputBufferSize: 64 * 1024,
	})
	if err != nil {
		return nil, fmt.Errorf("server: listen pipe %s: %w", s.addr, err)
	}
	return listener, nil
}
