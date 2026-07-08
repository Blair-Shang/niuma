//go:build !windows

package server

import (
	"fmt"
	"net"
	"os"
)

func (s *Server) listen() (net.Listener, error) {
	_ = os.Remove(s.addr)
	listener, err := net.Listen("unix", s.addr)
	if err != nil {
		return nil, fmt.Errorf("serviceipc: listen unix %s: %w", s.addr, err)
	}
	return listener, nil
}
