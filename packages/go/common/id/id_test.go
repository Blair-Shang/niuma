package id

import (
	"strings"
	"testing"
)

func TestUniqueID(t *testing.T) {
	a := UniqueID("q")
	b := UniqueID("q")
	if a == b {
		t.Fatalf("expected distinct ids, got %q twice", a)
	}
	if !strings.HasPrefix(a, "q-") || !strings.HasPrefix(b, "q-") {
		t.Fatalf("unexpected prefix: %q %q", a, b)
	}
}

func TestUniqueIDEmptyPrefix(t *testing.T) {
	got := UniqueID("")
	if !strings.HasPrefix(got, "id-") {
		t.Fatalf("expected id- prefix, got %q", got)
	}
}

func TestCoalesceID(t *testing.T) {
	if got := CoalesceID("  custom  ", "q"); got != "custom" {
		t.Fatalf("got %q", got)
	}
	got := CoalesceID("  ", "q")
	if !strings.HasPrefix(got, "q-") {
		t.Fatalf("expected generated q- id, got %q", got)
	}
}

func TestUniqueIDParallel(t *testing.T) {
	const n = 256
	ch := make(chan string, n)
	for i := 0; i < n; i++ {
		go func() { ch <- UniqueID("q") }()
	}
	seen := make(map[string]struct{}, n)
	for i := 0; i < n; i++ {
		uid := <-ch
		if _, ok := seen[uid]; ok {
			t.Fatalf("duplicate id %q", uid)
		}
		seen[uid] = struct{}{}
	}
}
