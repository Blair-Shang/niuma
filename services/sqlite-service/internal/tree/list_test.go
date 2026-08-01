package tree

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "t.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	stmts := []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`,
		`CREATE VIEW v_users AS SELECT id, name FROM users`,
		`CREATE INDEX idx_users_name ON users(name)`,
		`CREATE TRIGGER trg_users AFTER INSERT ON users BEGIN SELECT 1; END`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("exec %s: %v", s, err)
		}
	}
	return db
}

func TestListAndCounts(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	schemas, err := ListSchemas(ctx, db, ListParams{})
	if err != nil || len(schemas.Schemas) == 0 {
		t.Fatalf("schemas: %#v err=%v", schemas, err)
	}

	tables, err := ListTables(ctx, db, ListParams{ExcludeSystem: true, Types: []string{"table", "view"}})
	if err != nil {
		t.Fatal(err)
	}
	var sawTable, sawView bool
	for _, o := range tables.Objects {
		if o.Name == "users" && o.Type == "table" {
			sawTable = true
		}
		if o.Name == "v_users" && o.Type == "view" {
			sawView = true
		}
	}
	if !sawTable || !sawView {
		t.Fatalf("objects: %#v", tables.Objects)
	}

	counts, err := CountCategories(ctx, db, SchemaMain, true)
	if err != nil {
		t.Fatal(err)
	}
	if counts.Tables < 1 || counts.Views < 1 || counts.Indexes < 1 || counts.Triggers < 1 {
		t.Fatalf("counts: %#v", counts)
	}
}
