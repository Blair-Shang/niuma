//go:build !windows

package eventhub

import (
	"fmt"
	"net"
	"os"
)

func listen(addr string) (net.Listener, error) {
	if err := os.RemoveAll(addr); err != nil {
		return nil, fmt.Errorf("eventhub: remove socket: %w", err)
	}
	ln, err := net.Listen("unix", addr)
	if err != nil {
		return nil, fmt.Errorf("eventhub: listen %s: %w", addr, err)
	}
	return ln, nil
}
