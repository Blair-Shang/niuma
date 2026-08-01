package session

import (
	"context"
	"strconv"
	"testing"

	"niuma/services/clickhouse-service/internal/dialect"
)

func itoa(n int) string { return strconv.Itoa(n) }

// TestSessionCloseClearsMaps 确保 Close / Cancel 释放 inflight 与 resultSets，避免句柄泄漏。
func TestSessionCloseClearsMaps(t *testing.T) {
	t.Parallel()
	s := NewSession("s1", nil, ConnectParams{}, nil, &dialect.ServerProfile{Family: dialect.FamilyClickHouse})

	ctx, release := s.RegisterQuery(context.Background(), "req-1")
	_ = ctx
	if s.InflightCount() != 1 {
		t.Fatalf("inflight=%d", s.InflightCount())
	}
	release()
	if s.InflightCount() != 0 {
		t.Fatalf("after release inflight=%d", s.InflightCount())
	}

	_, cancel := context.WithCancel(context.Background())
	rs := &ResultSet{
		ID:        "rs-1",
		RequestID: "req-2",
		cancel:    cancel,
		closed:    true, // 已关闭，forceClose 仅清 cancel
	}
	s.putResultSet(rs)
	if s.ResultSetCount() != 1 {
		t.Fatalf("resultSets=%d", s.ResultSetCount())
	}

	n := s.CancelQuery("")
	if n < 1 {
		t.Fatalf("cancelled=%d", n)
	}
	if s.ResultSetCount() != 0 || s.InflightCount() != 0 {
		t.Fatalf("after cancel rs=%d inflight=%d", s.ResultSetCount(), s.InflightCount())
	}

	_, cancel2 := context.WithCancel(context.Background())
	s.putResultSet(&ResultSet{ID: "rs-2", RequestID: "req-3", cancel: cancel2, closed: true})
	s.Close()
	if s.ResultSetCount() != 0 || s.InflightCount() != 0 {
		t.Fatalf("after close rs=%d inflight=%d", s.ResultSetCount(), s.InflightCount())
	}
}

func TestManagerCloseRemovesSession(t *testing.T) {
	t.Parallel()
	m := NewManager()
	s := NewSession("abc", nil, ConnectParams{}, nil, nil)
	m.Put(s)
	if m.Len() != 1 {
		t.Fatal("len")
	}
	if err := m.Close("abc"); err != nil {
		t.Fatal(err)
	}
	if m.Len() != 0 {
		t.Fatal("manager leak")
	}
	if err := m.Close("abc"); err == nil {
		t.Fatal("second close must fail")
	}
}

func TestMaxOpenResultSetsEviction(t *testing.T) {
	t.Parallel()
	s := NewSession("s", nil, ConnectParams{}, nil, nil)
	for i := 0; i < MaxOpenResultSets+2; i++ {
		_, cancel := context.WithCancel(context.Background())
		s.putResultSet(&ResultSet{
			ID:        "rs-" + itoa(i),
			RequestID: "r",
			cancel:    cancel,
			closed:    true,
		})
	}
	// 驱逐异步 forceClose；数量不得超过上限。
	if s.ResultSetCount() > MaxOpenResultSets {
		t.Fatalf("resultSets=%d > max", s.ResultSetCount())
	}
	s.Close()
	if s.ResultSetCount() != 0 {
		t.Fatal("close must clear")
	}
}
