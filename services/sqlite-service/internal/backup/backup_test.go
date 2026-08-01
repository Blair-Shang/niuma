package backup

import (
	"context"
	"path/filepath"
	"testing"

	"niuma/services/sqlite-service/internal/session"
)

func TestCopyFile(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "src.db")
	dstPath := filepath.Join(dir, "dst.db")
	ctx := context.Background()

	db, err := session.Connect(ctx, session.ConnectParams{
		FilePath: srcPath,
		Options:  session.ConnectOptions{CreateIfMissing: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO t (id, v) VALUES (1, 'x')`); err != nil {
		t.Fatal(err)
	}

	if err := CopyFile(ctx, db, dstPath, nil); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()

	dst, err := session.Connect(ctx, session.ConnectParams{FilePath: dstPath})
	if err != nil {
		t.Fatal(err)
	}
	defer dst.Close()
	var n int
	if err := dst.QueryRowContext(ctx, `SELECT COUNT(*) FROM t`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("got %d", n)
	}
}
