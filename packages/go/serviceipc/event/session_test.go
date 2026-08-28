package event

import (
	"errors"
	"io"
	"testing"
)

func TestSessionLost(t *testing.T) {
	t.Parallel()
	got := SessionLost("ftp", "s1", "eof")
	if got["type"] != "ftp.session.state" || got["sessionId"] != "s1" || got["state"] != "lost" {
		t.Fatalf("%#v", got)
	}
}

func TestIsConnLost(t *testing.T) {
	t.Parallel()
	if IsConnLost(nil) {
		t.Fatal("nil")
	}
	if !IsConnLost(io.EOF) {
		t.Fatal("eof")
	}
	if !IsConnLost(errors.New("read tcp: broken pipe")) {
		t.Fatal("broken pipe")
	}
	if !IsConnLost(errors.New("driver: bad connection")) {
		t.Fatal("bad connection")
	}
	if IsConnLost(errors.New("ftp: session busy: transfer in progress")) {
		t.Fatal("busy is not lost")
	}
	if IsConnLost(errors.New("syntax error at line 1")) {
		t.Fatal("sql syntax is not lost")
	}
	if IsConnLost(errors.New("i/o timeout")) {
		t.Fatal("timeout is not lost")
	}
}

func TestSessionIDFromParams(t *testing.T) {
	t.Parallel()
	if got := SessionIDFromParams([]byte(`{"sessionId":"abc"}`)); got != "abc" {
		t.Fatalf("got %q", got)
	}
	if SessionIDFromParams(nil) != "" {
		t.Fatal("empty params")
	}
}
