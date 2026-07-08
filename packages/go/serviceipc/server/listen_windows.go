//go:build windows

package server

import (
	"fmt"
	"net"

	"github.com/Microsoft/go-winio"
)

func (s *Server) listen() (net.Listener, error) {
	listener, err := winio.ListenPipe(s.addr, &winio.PipeConfig{
		InputBufferSize:  64 * 1024,
		OutputBufferSize: 64 * 1024,
	})
	if err != nil {
		return nil, fmt.Errorf("serviceipc: listen pipe %s: %w", s.addr, err)
	}
	return listener, nil
}
