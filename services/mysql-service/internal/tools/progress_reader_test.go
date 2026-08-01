package tools

import (
	"io"
	"strings"
	"testing"
	"time"
)

func TestProgressReaderEmits(t *testing.T) {
	var msgs []string
	emit := func(_, _, message string) {
		msgs = append(msgs, message)
	}
	src := strings.NewReader(strings.Repeat("a", 3000))
	r := newProgressReader(src, 3000, "t1", emit)
	buf := make([]byte, 1024)
	for {
		_, err := r.Read(buf)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(msgs) == 0 {
		t.Fatal("expected progress messages")
	}
	last := msgs[len(msgs)-1]
	if !strings.Contains(last, "restoring") || !strings.Contains(last, "read") {
		t.Fatalf("unexpected last message: %q", last)
	}
}

func TestFormatRestoreProgressStalled(t *testing.T) {
	got := formatRestoreProgress(100, 1000, 5*time.Second)
	if !strings.Contains(got, "mysql busy 5s") || !strings.Contains(got, "stdin paused") {
		t.Fatalf("got %q", got)
	}
}

func TestFormatBytes(t *testing.T) {
	if formatBytes(500) != "500 B" {
		t.Fatalf("got %q", formatBytes(500))
	}
	if formatBytes(2048) != "2 KB" {
		t.Fatalf("got %q", formatBytes(2048))
	}
}
