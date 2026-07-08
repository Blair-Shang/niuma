//go:build !windows

package event

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
)

func dial(ctx context.Context, addr string) (net.Conn, error) {
	dialer := net.Dialer{Timeout: publishTimeout}
	return dialer.DialContext(ctx, "unix", addr)
}

func unixSocketPath(name string) string {
	return filepath.Join(os.TempDir(), name)
}

func marshalJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}
