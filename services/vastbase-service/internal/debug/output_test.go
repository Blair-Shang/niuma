package debug

import (
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestTrimOutputLinesFiltersProbeAndDedupes(t *testing.T) {
	in := []string{
		"hello",
		"hello",
		"nm_dbms_probe xxx",
		"world\r\n",
		"",
	}
	out := trimOutputLines(in)
	if len(out) != 3 {
		t.Fatalf("len=%d want 3: %#v", len(out), out)
	}
	if out[0] != "hello" || out[1] != "world" || out[2] != "" {
		t.Fatalf("unexpected: %#v", out)
	}
}

func TestNoticeSinkTakeClears(t *testing.T) {
	s := &NoticeSink{}
	h := s.Handler()
	h(nil, &pgconn.Notice{Message: "line1"})
	h(nil, &pgconn.Notice{Message: "line2"})
	got := s.Take()
	if len(got) != 2 || got[0] != "line1" || got[1] != "line2" {
		t.Fatalf("got %#v", got)
	}
	if again := s.Take(); again != nil {
		t.Fatalf("expected nil after take, got %#v", again)
	}
}

func TestMergeOutputSources(t *testing.T) {
	out := mergeOutputSources([]string{"a", "nm_dbms_probe"}, []string{"a", "b"})
	if len(out) != 2 || out[0] != "a" || out[1] != "b" {
		t.Fatalf("got %#v", out)
	}
}
