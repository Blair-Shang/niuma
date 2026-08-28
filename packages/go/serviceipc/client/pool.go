package client

import (
	"context"
	"fmt"
	"net"
	"sync"
	"time"
)

const (
	maxIdleConns = 8
	maxIdleAge   = 30 * time.Second
)

type idleConn struct {
	conn net.Conn
	at   time.Time
}

// connPool 复用空闲连接；取出后该连接上同时只跑一个请求（不在同一连接上流水线）。
type connPool struct {
	dial func(context.Context) (net.Conn, error)

	mu   sync.Mutex
	idle []idleConn
}

func newConnPool(dialFn func(context.Context) (net.Conn, error)) *connPool {
	return &connPool{dial: dialFn}
}

func (p *connPool) get(ctx context.Context) (conn net.Conn, reused bool, err error) {
	if p == nil {
		return nil, false, fmt.Errorf("serviceipc: nil conn pool")
	}
	var stale []net.Conn
	p.mu.Lock()
	now := time.Now()
	for len(p.idle) > 0 {
		last := p.idle[len(p.idle)-1]
		p.idle = p.idle[:len(p.idle)-1]
		if now.Sub(last.at) > maxIdleAge {
			stale = append(stale, last.conn)
			continue
		}
		p.mu.Unlock()
		for _, c := range stale {
			_ = c.Close()
		}
		return last.conn, true, nil
	}
	p.mu.Unlock()
	for _, c := range stale {
		_ = c.Close()
	}
	c, err := p.dial(ctx)
	return c, false, err
}

func (p *connPool) put(conn net.Conn) {
	if p == nil || conn == nil {
		if conn != nil {
			_ = conn.Close()
		}
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.idle) >= maxIdleConns {
		_ = conn.Close()
		return
	}
	p.idle = append(p.idle, idleConn{conn: conn, at: time.Now()})
}

func (p *connPool) closeAll() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, item := range p.idle {
		_ = item.conn.Close()
	}
	p.idle = nil
}
