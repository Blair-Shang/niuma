package ddl

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"niuma/services/sqlite-service/internal/session"
)

func TestBuildCreateTableSQL_CheckAndGenerated(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "main",
		Name:   "t",
		Columns: []CreateTableColumn{
			{Name: "price", DataType: "REAL", Nullable: false, Check: "price >= 0"},
			{
				Name: "tax", DataType: "REAL", Nullable: true,
				GeneratedExpr: "price * 0.1", GeneratedType: "VIRTUAL",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	s := sqls[0]
	if !strings.Contains(s, "CHECK (price >= 0)") {
		t.Fatalf("missing check: %s", s)
	}
	if !strings.Contains(strings.ToUpper(s), "GENERATED ALWAYS AS") || !strings.Contains(s, "VIRTUAL") {
		t.Fatalf("missing generated: %s", s)
	}
}

func TestBuildCreateTableSQL_AutoIncrement(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "main",
		Name:   "t",
		Columns: []CreateTableColumn{
			{Name: "id", DataType: "INTEGER", PrimaryKey: true, AutoIncrement: true, Nullable: false},
			{Name: "name", DataType: "TEXT", Nullable: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(sqls) != 1 {
		t.Fatalf("expected 1 stmt, got %d", len(sqls))
	}
	if !strings.Contains(sqls[0], "PRIMARY KEY AUTOINCREMENT") {
		t.Fatalf("sql: %s", sqls[0])
	}
}

func TestApplyCreateAndNativeAlter(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "t.db")
	ctx := context.Background()
	db, err := session.Connect(ctx, session.ConnectParams{
		FilePath: dbPath,
		Options:  session.ConnectOptions{CreateIfMissing: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = ApplyCreateTable(ctx, db, CreateTableParams{
		Schema: "main",
		Name:   "demo",
		Columns: []CreateTableColumn{
			{Name: "id", DataType: "INTEGER", PrimaryKey: true, AutoIncrement: true},
			{Name: "name", DataType: "TEXT", Nullable: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	preview, err := PreviewDesign(ctx, db, DesignPreviewParams{
		Schema: "main",
		Name:   "demo",
		Ops: []DesignOp{
			{Op: DesignAddColumn, Name: "age", DataType: "INTEGER", Nullable: boolPtr(true)},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if preview.Strategy != StrategyAlter {
		t.Fatalf("strategy %s", preview.Strategy)
	}
	_, err = ApplyDesign(ctx, db, DesignApplyParams{
		Schema: "main",
		Name:   "demo",
		Ops: []DesignOp{
			{Op: DesignAddColumn, Name: "age", DataType: "INTEGER", Nullable: boolPtr(true)},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestRebuildOnAlterType(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "t.db")
	ctx := context.Background()
	db, err := session.Connect(ctx, session.ConnectParams{
		FilePath: dbPath,
		Options:  session.ConnectOptions{CreateIfMissing: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.ExecContext(ctx, `CREATE TABLE main.demo (id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO main.demo (id, name) VALUES (1, 'a')`); err != nil {
		t.Fatal(err)
	}

	res, err := ApplyDesign(ctx, db, DesignApplyParams{
		Schema: "main",
		Name:   "demo",
		Ops: []DesignOp{
			{Op: DesignSetNotNull, Name: "name"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Strategy != StrategyRebuild {
		t.Fatalf("expected rebuild, got %s", res.Strategy)
	}
	var n int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM main.demo`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("rows %d", n)
	}
}
