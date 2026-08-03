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

func TestBuildCreateTableSQL_StrictWithoutRowidPartialIndex(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema:       "main",
		Name:         "t",
		Strict:       true,
		WithoutRowid: true,
		Columns: []CreateTableColumn{
			{Name: "id", DataType: "INTEGER", PrimaryKey: true, Nullable: false},
			{Name: "status", DataType: "INTEGER", Nullable: false},
		},
		Indexes: []CreateTableIndex{
			{Name: "idx_status", Columns: []string{"status"}, PartialWhere: "status = 1"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(sqls) != 2 {
		t.Fatalf("expected create + index, got %d", len(sqls))
	}
	if !strings.Contains(sqls[0], "WITHOUT ROWID") || !strings.Contains(sqls[0], "STRICT") {
		t.Fatalf("missing table options: %s", sqls[0])
	}
	if !strings.Contains(sqls[1], "WHERE status = 1") {
		t.Fatalf("missing partial where: %s", sqls[1])
	}
	// schema 在索引名上，ON 后为裸表名
	if !strings.Contains(sqls[1], `"main"."idx_status"`) || strings.Contains(sqls[1], `ON "main".`) {
		t.Fatalf("index schema qualification wrong: %s", sqls[1])
	}
}

func TestBuildCreateTableSQL_IndexSchemaOnName(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "main",
		Name:   "a1234",
		Columns: []CreateTableColumn{
			{Name: "id", DataType: "INTEGER", PrimaryKey: true, Nullable: false},
			{Name: "col_6", DataType: "TEXT", Nullable: true},
		},
		Indexes: []CreateTableIndex{
			{Name: "idx_col_6", Columns: []string{"col_6"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(sqls) != 2 {
		t.Fatalf("expected 2 stmts, got %d", len(sqls))
	}
	want := `CREATE INDEX IF NOT EXISTS "main"."idx_col_6" ON "a1234" ("col_6")`
	if sqls[1] != want {
		t.Fatalf("got %q want %q", sqls[1], want)
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

func TestApplyCreateTable_RollbackOnIndexFailure(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "rollback.db")
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
			{Name: "id", DataType: "INTEGER", PrimaryKey: true, Nullable: false},
			{Name: "status", DataType: "INTEGER", Nullable: true},
		},
		Indexes: []CreateTableIndex{
			{Name: "idx_bad", Columns: []string{"status"}, PartialWhere: "NOT A VALID EXPR !!!"},
		},
	})
	if err == nil {
		t.Fatal("expected index failure")
	}

	exists, err := objectExists(ctx, db, "main", "demo")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("table should not remain after failed create+index tx")
	}
}

func TestApplyCreateTable_RejectExisting(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "exists.db")
	ctx := context.Background()
	db, err := session.Connect(ctx, session.ConnectParams{
		FilePath: dbPath,
		Options:  session.ConnectOptions{CreateIfMissing: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	params := CreateTableParams{
		Schema: "main",
		Name:   "demo",
		Columns: []CreateTableColumn{
			{Name: "id", DataType: "INTEGER", PrimaryKey: true, AutoIncrement: true},
		},
	}
	if _, err := ApplyCreateTable(ctx, db, params); err != nil {
		t.Fatal(err)
	}
	_, err = ApplyCreateTable(ctx, db, params)
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("expected already exists, got %v", err)
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
