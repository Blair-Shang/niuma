package client

import (
	"context"
	"io"
	"net"
	"testing"
	"time"
)

func TestConnPool_ReusesIdle(t *testing.T) {
	t.Parallel()
	a, b := net.Pipe()
	defer func() { _ = a.Close(); _ = b.Close() }()
	go io.Copy(io.Discard, b)

	dials := 0
	p := newConnPool(func(context.Context) (net.Conn, error) {
		dials++
		t.Fatal("idle conn should be reused, dial must not run")
		return nil, nil
	})
	p.put(a)
	got, reused, err := p.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got != a || !reused {
		t.Fatal("expected same idle connection")
	}
	if dials != 0 {
		t.Fatalf("dials=%d", dials)
	}
}

func TestConnPool_ExpiresIdle(t *testing.T) {
	t.Parallel()
	expired, peer1 := net.Pipe()
	defer peer1.Close()
	fresh, peer2 := net.Pipe()
	defer func() { _ = fresh.Close(); _ = peer2.Close() }()

	p := newConnPool(func(context.Context) (net.Conn, error) {
		return fresh, nil
	})
	p.mu.Lock()
	p.idle = []idleConn{{conn: expired, at: time.Now().Add(-time.Hour)}}
	p.mu.Unlock()

	got, reused, err := p.get(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got != fresh || reused {
		t.Fatal("expired idle should be discarded")
	}
}
