//go:build windows

package streamserver

import (
	"fmt"
	"net"

	"github.com/Microsoft/go-winio"
)

func listen(addr string) (net.Listener, error) {
	ln, err := winio.ListenPipe(addr, &winio.PipeConfig{
		InputBufferSize:  64 * 1024,
		OutputBufferSize: 64 * 1024,
	})
	if err != nil {
		return nil, fmt.Errorf("streamserver: listen %s: %w", addr, err)
	}
	return ln, nil
}
