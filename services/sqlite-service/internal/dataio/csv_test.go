package dataio

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"niuma/services/sqlite-service/internal/idgen"
	"niuma/services/sqlite-service/internal/session"
)

func TestExportImportCsvRoundTrip(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "t.db")
	csvPath := filepath.Join(dir, "out.csv")

	ctx := context.Background()
	db, err := session.Connect(ctx, session.ConnectParams{
		FilePath: dbPath,
		Options:  session.ConnectOptions{CreateIfMissing: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE main.demo (id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO main.demo (id, name) VALUES (1, 'a'), (2, NULL)`); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()

	ids, err := idgen.NewSnowflake(1)
	if err != nil {
		t.Fatal(err)
	}
	m := NewManager(ids, func(map[string]any) {})
	connect := session.ConnectParams{FilePath: dbPath}

	taskID, err := m.ExportCsv(ctx, connect, "s1", "main", "demo", csvPath, CsvOptions{
		Header:     true,
		NullString: "\\N",
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTaskGone(t, m, taskID)

	raw, err := os.ReadFile(csvPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) < 3 || raw[0] != 0xEF || raw[1] != 0xBB || raw[2] != 0xBF {
		preview := raw
		if len(preview) > 8 {
			preview = preview[:8]
		}
		t.Fatalf("expected utf-8 bom prefix, got %q", string(preview))
	}

	taskID, err = m.ImportCsv(ctx, connect, "s1", "main", "demo", csvPath, CsvOptions{
		Header:     true,
		Truncate:   true,
		NullString: "\\N",
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTaskGone(t, m, taskID)
}

func waitTaskGone(t *testing.T, m *Manager, taskID string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		m.mu.Lock()
		_, ok := m.tasks[taskID]
		m.mu.Unlock()
		if !ok {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("task %s still running", taskID)
}
