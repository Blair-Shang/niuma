package client

import (
	"context"
	"io"
	"net"
	"sync/atomic"
	"testing"

	"niuma/pkg/serviceipc/protocol"
)

type writeFailConn struct {
	net.Conn
}

func (c writeFailConn) Write([]byte) (int, error) {
	return 0, io.ErrClosedPipe
}

func TestRoundTrip_RetriesOnlyWhenPooledWriteFails(t *testing.T) {
	t.Parallel()
	srv, peer := net.Pipe()
	defer srv.Close()
	defer peer.Close()

	go func() {
		for {
			payload, err := protocol.ReadFrame(srv)
			if err != nil {
				return
			}
			_ = protocol.WriteFrame(srv, payload)
		}
	}()

	var dials atomic.Int32
	c := &Client{addr: "test"}
	c.once.Do(func() {})
	c.pool = newConnPool(func(context.Context) (net.Conn, error) {
		dials.Add(1)
		return peer, nil
	})
	dead, deadPeer := net.Pipe()
	_ = deadPeer.Close()
	c.pool.put(writeFailConn{Conn: dead})

	payload := []byte(`{"method":"ping","id":"1"}`)
	got, err := c.roundTrip(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) {
		t.Fatalf("echo mismatch %q", got)
	}
	if dials.Load() != 1 {
		t.Fatalf("dials=%d want 1 (stale write then redial)", dials.Load())
	}
}

type writeOKReadFailConn struct {
	net.Conn
}

func (c writeOKReadFailConn) Write(p []byte) (int, error) {
	return len(p), nil
}

func (c writeOKReadFailConn) Read([]byte) (int, error) {
	return 0, io.ErrUnexpectedEOF
}

func TestRoundTrip_DoesNotRetryAfterWriteSucceeds(t *testing.T) {
	t.Parallel()
	dummy, peer := net.Pipe()
	defer dummy.Close()
	defer peer.Close()

	var dials atomic.Int32
	c := &Client{addr: "test"}
	c.once.Do(func() {})
	c.pool = newConnPool(func(context.Context) (net.Conn, error) {
		dials.Add(1)
		t.Fatal("must not redial after write succeeded")
		return nil, nil
	})
	c.pool.put(writeOKReadFailConn{Conn: dummy})

	_, err := c.roundTrip(context.Background(), []byte(`{"method":"x","id":"1"}`))
	if err == nil {
		t.Fatal("expected read error")
	}
	if dials.Load() != 0 {
		t.Fatalf("dials=%d want 0", dials.Load())
	}
}
