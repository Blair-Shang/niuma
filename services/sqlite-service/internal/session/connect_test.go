package session

import (
	"context"
	"path/filepath"
	"testing"
)

func TestConnectCreateAndQuery(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "demo.db")
	db, err := Connect(context.Background(), ConnectParams{
		FilePath: path,
		Options: ConnectOptions{
			CreateIfMissing: true,
			JournalMode:     "WAL",
		},
	})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer db.Close()

	if _, err := db.Exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO t(name) VALUES ('a')`); err != nil {
		t.Fatalf("insert: %v", err)
	}
	res, err := ExecOnDB(context.Background(), db, `SELECT id, name FROM t`, 10, "q1")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if res.RowCount != 1 {
		t.Fatalf("rows %d", res.RowCount)
	}
}

func TestConnectMissingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.db")
	_, err := Connect(context.Background(), ConnectParams{FilePath: path})
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestConnectRejectsEncryptionPassword(t *testing.T) {
	path := filepath.Join(t.TempDir(), "enc.db")
	_, err := Connect(context.Background(), ConnectParams{
		FilePath: path,
		Secret:   "not-supported",
		Options:  ConnectOptions{CreateIfMissing: true},
	})
	if err == nil {
		t.Fatal("expected error when encryption password is set")
	}
}

func TestConnectReadOnly(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ro.db")
	db, err := Connect(context.Background(), ConnectParams{
		FilePath: path,
		Options:  ConnectOptions{CreateIfMissing: true},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	_, _ = db.Exec(`CREATE TABLE t(id INTEGER)`)
	_ = db.Close()

	ro, err := Connect(context.Background(), ConnectParams{
		FilePath: path,
		Options:  ConnectOptions{ReadOnly: true},
	})
	if err != nil {
		t.Fatalf("ro open: %v", err)
	}
	defer ro.Close()
	_, err = ro.Exec(`INSERT INTO t VALUES (1)`)
	if err == nil {
		t.Fatal("expected write failure in read-only mode")
	}
}
