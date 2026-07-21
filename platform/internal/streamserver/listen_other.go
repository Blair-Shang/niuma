//go:build !windows

package streamserver

import (
	"fmt"
	"net"
	"os"
)

func listen(addr string) (net.Listener, error) {
	_ = os.Remove(addr)
	ln, err := net.Listen("unix", addr)
	if err != nil {
		return nil, fmt.Errorf("streamserver: listen %s: %w", addr, err)
	}
	return ln, nil
}
