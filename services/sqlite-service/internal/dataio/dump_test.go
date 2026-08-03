package dataio

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"niuma/services/sqlite-service/internal/idgen"
	"niuma/services/sqlite-service/internal/session"
)

func TestDumpSqlIncludesIndexesForSelectedTable(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "t.db")
	outPath := filepath.Join(dir, "out.sql")

	ctx := context.Background()
	db, err := session.Connect(ctx, session.ConnectParams{
		FilePath: dbPath,
		Options:  session.ConnectOptions{CreateIfMissing: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	stmts := []string{
		`CREATE TABLE main.users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)`,
		`CREATE INDEX main.idx_users_name ON users(name)`,
		`CREATE UNIQUE INDEX main.idx_users_email ON users(email)`,
		`CREATE TABLE main.orders (id INTEGER PRIMARY KEY, user_id INTEGER)`,
		`CREATE INDEX main.idx_orders_user ON orders(user_id)`,
	}
	for _, s := range stmts {
		if _, err := db.ExecContext(ctx, s); err != nil {
			t.Fatal(err)
		}
	}
	_ = db.Close()

	ids, err := idgen.NewSnowflake(1)
	if err != nil {
		t.Fatal(err)
	}
	m := NewManager(ids, func(map[string]any) {})
	connect := session.ConnectParams{FilePath: dbPath}

	taskID, err := m.DumpSql(ctx, connect, "s1", DumpParams{
		Schema:         "main",
		Tables:         []string{"users"},
		Mode:           DumpStructureOnly,
		OutputPath:     outPath,
		IncludeTables:  true,
		IncludeIndexes: true,
		IncludeViews:   false,
		IncludeTriggers: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTaskGone(t, m, taskID)

	raw, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatal(err)
	}
	sqlText := string(raw)
	for _, needle := range []string{
		`CREATE TABLE`,
		`users`,
		`CREATE INDEX`,
		`idx_users_name`,
		`idx_users_email`,
	} {
		if !strings.Contains(sqlText, needle) {
			t.Fatalf("dump missing %q:\n%s", needle, sqlText)
		}
	}
	if strings.Contains(sqlText, "idx_orders_user") || strings.Contains(sqlText, "orders") {
		t.Fatalf("dump should not include unrelated table/index:\n%s", sqlText)
	}
}

func TestDumpSqlRoundTripKeepsIndexes(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "src.db")
	dstPath := filepath.Join(dir, "dst.db")
	sqlPath := filepath.Join(dir, "dump.sql")

	ctx := context.Background()
	src, err := session.Connect(ctx, session.ConnectParams{
		FilePath: srcPath,
		Options:  session.ConnectOptions{CreateIfMissing: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := src.ExecContext(ctx, `CREATE TABLE main.t (id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := src.ExecContext(ctx, `CREATE INDEX main.idx_t_name ON t(name)`); err != nil {
		t.Fatal(err)
	}
	if _, err := src.ExecContext(ctx, `INSERT INTO main.t (id, name) VALUES (1, 'a')`); err != nil {
		t.Fatal(err)
	}
	_ = src.Close()

	ids, err := idgen.NewSnowflake(1)
	if err != nil {
		t.Fatal(err)
	}
	m := NewManager(ids, func(map[string]any) {})

	taskID, err := m.DumpSql(ctx, session.ConnectParams{FilePath: srcPath}, "s1", DumpParams{
		Schema:          "main",
		Tables:          []string{"t"},
		Mode:            DumpStructureAndData,
		OutputPath:      sqlPath,
		DropIfExists:    true,
		IncludeTables:   true,
		IncludeIndexes:  true,
		IncludeViews:    false,
		IncludeTriggers: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitTaskGone(t, m, taskID)

	dst, err := session.Connect(ctx, session.ConnectParams{
		FilePath: dstPath,
		Options:  session.ConnectOptions{CreateIfMissing: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = dst.Close()

	taskID, err = m.ExecSqlFile(ctx, session.ConnectParams{FilePath: dstPath}, "s2", "main", sqlPath, ExecSqlFileOptions{})
	if err != nil {
		t.Fatal(err)
	}
	waitTaskGone(t, m, taskID)

	check, err := session.Connect(ctx, session.ConnectParams{FilePath: dstPath})
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()

	var idxCount int
	if err := check.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM main.sqlite_master WHERE type='index' AND name='idx_t_name'`,
	).Scan(&idxCount); err != nil {
		t.Fatal(err)
	}
	if idxCount != 1 {
		t.Fatalf("expected index restored, got count=%d", idxCount)
	}
}
