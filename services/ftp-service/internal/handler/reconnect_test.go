package handler

import (
	"errors"
	"io"
	"testing"
)

func TestIsFTPConnLost(t *testing.T) {
	t.Parallel()
	if isFTPConnLost(nil) {
		t.Fatal("nil")
	}
	if !isFTPConnLost(io.EOF) {
		t.Fatal("eof")
	}
	if !isFTPConnLost(errors.New("421 Service not available")) {
		t.Fatal("421")
	}
	if !isFTPConnLost(errors.New("not connected")) {
		t.Fatal("not connected")
	}
	if isFTPConnLost(errors.New("ftp: session busy: transfer in progress")) {
		t.Fatal("busy is not lost")
	}
	if isFTPConnLost(errors.New("550 directory already exists")) {
		t.Fatal("550 is not lost")
	}
	if !isFTPConnLost(errors.New("dial tcp 47.102.153.34:51617: operation was canceled")) {
		t.Fatal("operation was canceled")
	}
}
