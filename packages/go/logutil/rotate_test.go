package logutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRotatingWriterRollsAtMaxSize(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.log")
	w := newRotatingWriter(path)
	defer func() { _ = w.close() }()
	w.maxSize = 16

	if _, err := w.Write([]byte("1234567890123456")); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("extra")); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatalf("expected backup log: %v", err)
	}
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if st.Size() != int64(len("extra")) {
		t.Fatalf("new log size = %d, want %d", st.Size(), len("extra"))
	}
}
