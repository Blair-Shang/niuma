package ddl

import (
	"strings"
	"testing"
)

func TestBuildCreateTableBasic(t *testing.T) {
	def := "SYSDATE"
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "HR",
		Name:   "orders",
		Columns: []CreateTableColumn{
			{Name: "id", DataType: "BIGINT", Nullable: false, PrimaryKey: true, AutoIncrement: true},
			{Name: "title", DataType: "VARCHAR(100)", Nullable: true},
			{Name: "created_at", DataType: "TIMESTAMP", Nullable: false, Default: &def, Comment: "创建时间"},
		},
		Comment: "订单表",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(sqls) != 3 {
		t.Fatalf("len=%d sql=%v", len(sqls), sqls)
	}
	wantCreate := `CREATE TABLE "HR"."orders" (
  "id" BIGINT IDENTITY(1,1) NOT NULL,
  "title" VARCHAR(100),
  "created_at" TIMESTAMP NOT NULL DEFAULT SYSDATE,
  PRIMARY KEY ("id")
)`
	if sqls[0] != wantCreate {
		t.Fatalf("create=\n%s", sqls[0])
	}
	if sqls[1] != `COMMENT ON TABLE "HR"."orders" IS '订单表'` {
		t.Fatalf("table comment=%q", sqls[1])
	}
	if sqls[2] != `COMMENT ON COLUMN "HR"."orders"."created_at" IS '创建时间'` {
		t.Fatalf("col comment=%q", sqls[2])
	}
}

func TestBuildCreateTableWithCheck(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "HR",
		Name:   "t",
		Columns: []CreateTableColumn{
			{Name: "age", DataType: "INT", Nullable: false},
		},
		Checks: []CreateTableCheck{
			{Name: "ck_age", Expression: "age >= 0"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	last := sqls[len(sqls)-1]
	want := `ALTER TABLE "HR"."t" ADD CONSTRAINT "ck_age" CHECK (age >= 0)`
	if last != want {
		t.Fatalf("check=%q", last)
	}
}

func TestBuildCreateTableIndexMethod(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "HR",
		Name:   "t",
		Columns: []CreateTableColumn{
			{Name: "a", DataType: "INT", Nullable: true},
			{Name: "b", DataType: "INT", Nullable: true},
		},
		Indexes: []CreateTableIndex{
			{Name: "idx_a", Columns: []string{"a"}, Method: "BTREE"},
			{Name: "idx_b", Columns: []string{"b"}, Unique: true, Method: "HASH"},
			{Name: "idx_bm", Columns: []string{"a"}, Method: "BITMAP"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(sqls, "\n")
	for _, want := range []string{
		`CREATE INDEX "idx_a" ON "HR"."t" ("a")`,
		`CREATE UNIQUE HASH INDEX "idx_b" ON "HR"."t" ("b")`,
		`CREATE BITMAP INDEX "idx_bm" ON "HR"."t" ("a")`,
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in\n%s", want, joined)
		}
	}
}

func TestBuildCreateTableFKCrossSchema(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "HR",
		Name:   "child",
		Columns: []CreateTableColumn{
			{Name: "pid", DataType: "INT", Nullable: false},
		},
		ForeignKeys: []CreateTableForeignKey{
			{
				Name:       "fk_parent",
				Columns:    []string{"pid"},
				RefSchema:  "OTHER",
				RefTable:   "parent",
				RefColumns: []string{"id"},
				OnDelete:   "CASCADE",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sqls[0], `CONSTRAINT "fk_parent" FOREIGN KEY ("pid") REFERENCES "OTHER"."parent" ("id") ON DELETE CASCADE`) {
		t.Fatalf("create=\n%s", sqls[0])
	}
}

func TestBuildCreateTableFKDefaultSchema(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "HR",
		Name:   "child",
		Columns: []CreateTableColumn{
			{Name: "pid", DataType: "INT", Nullable: false},
		},
		ForeignKeys: []CreateTableForeignKey{
			{
				Columns:    []string{"pid"},
				RefTable:   "parent",
				RefColumns: []string{"id"},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sqls[0], `REFERENCES "HR"."parent" ("id")`) {
		t.Fatalf("create=\n%s", sqls[0])
	}
}

func TestBuildCreateTableRejectsInjection(t *testing.T) {
	_, err := BuildCreateTableSQL(CreateTableParams{
		Schema:  "HR",
		Name:    "t",
		Columns: []CreateTableColumn{{Name: "a", DataType: "INT; DROP TABLE x", Nullable: true}},
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestBuildCreateTableRequiresColumns(t *testing.T) {
	_, err := BuildCreateTableSQL(CreateTableParams{Schema: "HR", Name: "t"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestBuildCreateTableDuplicateColumn(t *testing.T) {
	_, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "HR",
		Name:   "t",
		Columns: []CreateTableColumn{
			{Name: "a", DataType: "INT", Nullable: true},
			{Name: "A", DataType: "INT", Nullable: true},
		},
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestBuildCreateTableIdentityColumn(t *testing.T) {
	sqls, err := BuildCreateTableSQL(CreateTableParams{
		Schema: "HR",
		Name:   "t",
		Columns: []CreateTableColumn{
			{Name: "id", DataType: "BIGINT", Nullable: false, PrimaryKey: true, AutoIncrement: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sqls[0], `"id" BIGINT IDENTITY(1,1) NOT NULL`) {
		t.Fatalf("create=\n%s", sqls[0])
	}
}

func TestBuildAddCheckDesignOp(t *testing.T) {
	sql, err := buildDesignSQL("HR", "t", DesignOp{
		Op:         DesignAddCheck,
		Name:       "ck_pos",
		Expression: "n > 0",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `ALTER TABLE "HR"."t" ADD CONSTRAINT "ck_pos" CHECK (n > 0)`
	if sql != want {
		t.Fatalf("got %q", sql)
	}
}

func TestBuildAddIndexWithMethod(t *testing.T) {
	uniq := true
	sql, err := buildAddIndex("HR", "t", DesignOp{
		Op:      DesignAddIndex,
		Name:    "idx_h",
		Columns: []string{"a"},
		Unique:  &uniq,
		Method:  "HASH",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `CREATE UNIQUE HASH INDEX "idx_h" ON "HR"."t" ("a")`
	if sql != want {
		t.Fatalf("got %q", sql)
	}
}

func TestRenameColumnSameNameWithDataTypeBecomesModify(t *testing.T) {
	// 同名 + dataType：落成 MODIFY（非 AI 场景的类型/空值变更）
	sql, err := buildDesignSQL("DATAHUB_TEST", "my_test", DesignOp{
		Op:       DesignRenameColumn,
		Name:     "col_2",
		NewName:  "col_2",
		DataType: "VARCHAR(255) NOT NULL",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `ALTER TABLE "DATAHUB_TEST"."my_test" MODIFY "col_2" VARCHAR(255) NOT NULL`
	if sql != want {
		t.Fatalf("got %q", sql)
	}
}

func TestDropAndAddIdentity(t *testing.T) {
	drop, err := buildDesignSQL("DATAHUB_TEST", "my_test", DesignOp{Op: DesignDropIdentity})
	if err != nil {
		t.Fatal(err)
	}
	if drop != `ALTER TABLE "DATAHUB_TEST"."my_test" DROP IDENTITY` {
		t.Fatalf("drop=%q", drop)
	}
	add, err := buildDesignSQL("DATAHUB_TEST", "my_test", DesignOp{
		Op: DesignAddIdentity, Name: "id",
	})
	if err != nil {
		t.Fatal(err)
	}
	if add != `ALTER TABLE "DATAHUB_TEST"."my_test" ADD "id" IDENTITY(1,1)` {
		t.Fatalf("add=%q", add)
	}
}

func TestPkSwitchIdentityPreviewOrder(t *testing.T) {
	// 主键从 id(AI) 切到 col_2：须 DROP IDENTITY，禁止 MODIFY 自增列
	preview, err := PreviewDesign(DesignPreviewParams{
		Schema: "DATAHUB_TEST",
		Name:   "my_test",
		Ops: []DesignOp{
			{Op: DesignDropIdentity},
			{Op: DesignDropPrimaryKey},
			{Op: DesignAddPrimaryKey, Columns: []string{"col_2"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.SQL) != 3 {
		t.Fatalf("len=%d sql=%v", len(preview.SQL), preview.SQL)
	}
	if preview.SQL[0] != `ALTER TABLE "DATAHUB_TEST"."my_test" DROP IDENTITY` {
		t.Fatalf("sql0=%q", preview.SQL[0])
	}
	if preview.SQL[1] != `ALTER TABLE "DATAHUB_TEST"."my_test" DROP PRIMARY KEY` {
		t.Fatalf("sql1=%q", preview.SQL[1])
	}
	if preview.SQL[2] != `ALTER TABLE "DATAHUB_TEST"."my_test" ADD PRIMARY KEY ("col_2")` {
		t.Fatalf("sql2=%q", preview.SQL[2])
	}
}

func TestRenameColumnWithDataTypeExpandsToRenameAndModify(t *testing.T) {
	preview, err := PreviewDesign(DesignPreviewParams{
		Schema: "HR",
		Name:   "t",
		Ops: []DesignOp{{
			Op:       DesignRenameColumn,
			Name:     "old_col",
			NewName:  "new_col",
			DataType: "INT NOT NULL",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.SQL) != 2 {
		t.Fatalf("len=%d sql=%v", len(preview.SQL), preview.SQL)
	}
	if preview.SQL[0] != `ALTER TABLE "HR"."t" RENAME COLUMN "old_col" TO "new_col"` {
		t.Fatalf("rename=%q", preview.SQL[0])
	}
	if preview.SQL[1] != `ALTER TABLE "HR"."t" MODIFY "new_col" INT NOT NULL` {
		t.Fatalf("modify=%q", preview.SQL[1])
	}
}
