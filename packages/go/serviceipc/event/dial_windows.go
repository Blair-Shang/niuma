//go:build windows

package event

import (
	"context"
	"encoding/json"
	"fmt"
	"net"

	"github.com/Microsoft/go-winio"
)

func dial(ctx context.Context, addr string) (net.Conn, error) {
	return winio.DialPipeContext(ctx, addr)
}

func unixSocketPath(name string) string {
	return fmt.Sprintf("/tmp/%s", name)
}

func marshalJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}
