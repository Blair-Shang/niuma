package session

import (
	"context"
	"path/filepath"
	"testing"
)

func TestApplyAttach(t *testing.T) {
	dir := t.TempDir()
	mainPath := filepath.Join(dir, "main.db")
	otherPath := filepath.Join(dir, "other.db")
	ctx := context.Background()

	other, err := Connect(ctx, ConnectParams{
		FilePath: otherPath,
		Options:  ConnectOptions{CreateIfMissing: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := other.ExecContext(ctx, `CREATE TABLE t (id INTEGER)`); err != nil {
		t.Fatal(err)
	}
	_ = other.Close()

	db, err := Connect(ctx, ConnectParams{
		FilePath: mainPath,
		Options: ConnectOptions{
			CreateIfMissing: true,
			Attach: []AttachEntry{
				{Alias: "extra", FilePath: otherPath},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	var n int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM extra.t`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("expected 0 rows, got %d", n)
	}

	if err := ApplyDetach(ctx, db, []string{"extra"}); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM extra.t`).Scan(&n); err == nil {
		t.Fatal("expected query on detached schema to fail")
	}
	if err := ApplyDetach(ctx, db, []string{"main"}); err == nil {
		t.Fatal("expected detach main to fail")
	}
}
