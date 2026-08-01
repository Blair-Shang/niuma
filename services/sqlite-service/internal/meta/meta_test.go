package meta

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestColumnsIndexesDDLKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), "m.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	_, err = db.Exec(`
CREATE TABLE parent (id INTEGER PRIMARY KEY);
CREATE TABLE child (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL REFERENCES parent(id),
  name TEXT
);
CREATE INDEX idx_child_name ON child(name);
`)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	cols, err := ListColumns(ctx, db, "main", "child")
	if err != nil || len(cols.Columns) < 3 {
		t.Fatalf("columns: %#v err=%v", cols, err)
	}
	idx, err := ListIndexes(ctx, db, "main", "child")
	if err != nil {
		t.Fatal(err)
	}
	if len(idx.Indexes) < 1 {
		t.Fatalf("indexes: %#v", idx)
	}
	ddl, err := GetDDL(ctx, db, "main", "child", "table")
	if err != nil || !strings.Contains(strings.ToUpper(ddl.DDL), "CREATE") {
		t.Fatalf("ddl: %#v err=%v", ddl, err)
	}
	pk, err := GetPrimaryKey(ctx, db, "main", "child")
	if err != nil || len(pk.Columns) != 1 || pk.Columns[0] != "id" {
		t.Fatalf("pk: %#v err=%v", pk, err)
	}
	fks, err := ListForeignKeys(ctx, db, "main", "child")
	if err != nil || len(fks.ForeignKeys) < 1 {
		t.Fatalf("fks: %#v err=%v", fks, err)
	}
}

func TestListColumnsGeneratedAndCheck(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gen.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
CREATE TABLE t (
  price REAL NOT NULL CHECK (price >= 0),
  tax REAL GENERATED ALWAYS AS (price * 0.1) VIRTUAL
)`)
	if err != nil {
		t.Fatal(err)
	}
	cols, err := ListColumns(context.Background(), db, "main", "t")
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]ColumnInfo{}
	for _, c := range cols.Columns {
		byName[c.Name] = c
	}
	if byName["price"].Check == "" {
		t.Fatalf("expected check on price: %#v", byName["price"])
	}
	tax := byName["tax"]
	if tax.GeneratedType != "VIRTUAL" {
		t.Fatalf("tax generatedType: %#v", tax)
	}
	if tax.GeneratedExpr == "" {
		t.Fatalf("tax generatedExpr empty: %#v", tax)
	}
}

func TestGetDatabaseInfo(t *testing.T) {
	path := filepath.Join(t.TempDir(), "info.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(`CREATE TABLE t (id INTEGER PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	info, err := GetDatabaseInfo(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if info.Version == "" {
		t.Fatal("expected sqlite_version")
	}
	if info.PageSize <= 0 {
		t.Fatalf("pageSize: %d", info.PageSize)
	}
	if len(info.Databases) < 1 || info.Databases[0].Name != "main" {
		t.Fatalf("databases: %#v", info.Databases)
	}
}
