package dataio

import (
	"strings"
	"testing"
)

func TestWriteValueLiteralArray(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	writeValueLiteral(&b, []interface{}{int64(1), "a", nil})
	got := b.String()
	if got != "[1, 'a', NULL]" {
		t.Fatalf("got %q", got)
	}
}

func TestWriteValueLiteralMap(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	writeValueLiteral(&b, map[string]interface{}{"b": int64(2), "a": int64(1)})
	got := b.String()
	if got != "map('a', 1, 'b', 2)" {
		t.Fatalf("got %q", got)
	}
}

func TestWriteValueLiteralNestedArray(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	writeValueLiteral(&b, []int{1, 2, 3})
	got := b.String()
	if got != "[1, 2, 3]" {
		t.Fatalf("got %q", got)
	}
}

func TestIsProtectedDatabase(t *testing.T) {
	t.Parallel()
	if !isProtectedDatabase("system") {
		t.Fatal("system")
	}
	if isProtectedDatabase("app") {
		t.Fatal("app")
	}
}
