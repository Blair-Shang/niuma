package session

import (
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestNoticeSinkTakeClears(t *testing.T) {
	s := &NoticeSink{}
	h := s.Handler()
	h(nil, &pgconn.Notice{Message: "p_ret=1:a"})
	h(nil, &pgconn.Notice{Message: "p_code=0\n"})
	got := s.Take()
	if len(got) != 2 || got[0] != "p_ret=1:a" || got[1] != "p_code=0" {
		t.Fatalf("Take = %#v", got)
	}
	if again := s.Take(); again != nil {
		t.Fatalf("second Take = %#v", again)
	}
}

func TestNoticeSinkClear(t *testing.T) {
	s := &NoticeSink{}
	s.Handler()(nil, &pgconn.Notice{Message: "x"})
	s.Clear()
	if got := s.Take(); got != nil {
		t.Fatalf("after Clear Take = %#v", got)
	}
}

func TestNoticeSinkNilSafe(t *testing.T) {
	var s *NoticeSink
	s.Clear()
	if got := s.Take(); got != nil {
		t.Fatalf("nil Take = %#v", got)
	}
	s.Handler()(nil, &pgconn.Notice{Message: "x"})
}
