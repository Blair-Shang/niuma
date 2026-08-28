package logutil

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestObserveIPC_RoundTripSearchAndSummary(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NIUMMA_LOG_DIR", dir)
	t.Setenv("NIUMMA_LOG_ROOT", "")
	setServiceName("observe-test")
	t.Cleanup(CloseObserve)

	ObserveIPC(
		[]byte(`{"method":"mysql.query.exec","id":"a1","traceId":"tr-1"}`),
		[]byte(`{"ok":true,"id":"a1","traceId":"tr-1","result":""}`),
		50*time.Millisecond,
	)
	ObserveIPC(
		[]byte(`{"method":"mysql.query.exec","id":"a2","traceId":"tr-1"}`),
		[]byte(`{"ok":false,"id":"a2","traceId":"tr-1","errorCode":"timeout","error":"deadline exceeded","result":""}`),
		300*time.Millisecond,
	)
	ObserveIPC(
		[]byte(`{"method":"platform.diag.trace","id":"skip"}`),
		[]byte(`{"ok":true,"id":"skip","result":""}`),
		10*time.Millisecond,
	)

	hits := SearchTrace("tr-1", 10)
	if len(hits) != 2 {
		t.Fatalf("SearchTrace len=%d want 2: %+v", len(hits), hits)
	}
	sum := Summarize(100)
	if sum.RPCTotal != 2 || sum.FailTotal != 1 || sum.SlowTotal != 1 {
		t.Fatalf("summary %+v", sum)
	}
	if sum.Dir != dir {
		t.Fatalf("dir=%q want %q", sum.Dir, dir)
	}
	raw, err := os.ReadFile(filepath.Join(dir, ObserveFileName))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, `"traceId":"tr-1"`) || !strings.Contains(text, `"errorCode":"timeout"`) {
		t.Fatalf("observe file: %s", text)
	}
	if strings.Contains(text, "platform.diag.trace") {
		t.Fatal("diag methods must not be recorded")
	}
}

func TestObserveIPC_SkipsEmptyMethod(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NIUMMA_LOG_DIR", dir)
	t.Setenv("NIUMMA_LOG_ROOT", "")
	setServiceName("observe-test")
	ObserveIPC([]byte(`{"id":"x"}`), []byte(`{"ok":true}`), time.Millisecond)
	if _, err := os.Stat(filepath.Join(dir, ObserveFileName)); !os.IsNotExist(err) {
		t.Fatalf("expected no observe file, err=%v", err)
	}
}
