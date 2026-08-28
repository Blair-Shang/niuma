package transfer

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/jlaffaye/ftp"
)

func TestIsConnLost(t *testing.T) {
	t.Parallel()
	if isConnLost(nil) {
		t.Fatal("nil")
	}
	if !isConnLost(io.EOF) {
		t.Fatal("eof")
	}
	if !isConnLost(errors.New("421 Timeout.")) {
		t.Fatal("421")
	}
	if !isConnLost(errors.New("426 Connection closed; transfer aborted.")) {
		t.Fatal("426")
	}
	if !isConnLost(errors.New("connection was aborted")) {
		t.Fatal("aborted")
	}
	if isConnLost(errors.New("550 file not found")) {
		t.Fatal("550 is not lost")
	}
	if !isConnLost(errors.New("retr /a: dial tcp 10.0.0.1:51617: operation was canceled")) {
		t.Fatal("operation was canceled")
	}
}

func TestRetryOnConnLostReconnectsOnce(t *testing.T) {
	t.Parallel()
	attempts := 0
	reconnects := 0
	lease := &ConnLease{
		Reconnect: func() (*ftp.ServerConn, error) {
			reconnects++
			return nil, nil
		},
	}
	n, err := retryOnConnLost(context.Background(), lease, func() (int, error) {
		attempts++
		if attempts == 1 {
			return 0, errors.New("broken pipe")
		}
		return 7, nil
	})
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if n != 7 || attempts != 2 || reconnects != 1 {
		t.Fatalf("n=%d attempts=%d reconnects=%d", n, attempts, reconnects)
	}
}

func TestRetryOnConnLostReconnectsOnDialCanceled(t *testing.T) {
	t.Parallel()
	attempts := 0
	reconnects := 0
	lease := &ConnLease{
		Reconnect: func() (*ftp.ServerConn, error) {
			reconnects++
			return nil, nil
		},
	}
	n, err := retryOnConnLost(context.Background(), lease, func() (int, error) {
		attempts++
		if attempts == 1 {
			return 0, errors.New("retr /a: dial tcp 10.0.0.1:51617: operation was canceled")
		}
		return 3, nil
	})
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if n != 3 || attempts != 2 || reconnects != 1 {
		t.Fatalf("n=%d attempts=%d reconnects=%d", n, attempts, reconnects)
	}
}

func TestRetryOnConnLostStopsOnNonConnError(t *testing.T) {
	t.Parallel()
	reconnects := 0
	lease := &ConnLease{
		Reconnect: func() (*ftp.ServerConn, error) {
			reconnects++
			return nil, nil
		},
	}
	_, err := retryOnConnLost(context.Background(), lease, func() (int, error) {
		return 0, errors.New("550 permission denied")
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if reconnects != 0 {
		t.Fatalf("reconnects=%d", reconnects)
	}
}
