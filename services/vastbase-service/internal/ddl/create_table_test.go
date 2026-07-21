package ddl

import "testing"

func TestPreviewCreateTableBasic(t *testing.T) {
	def := "CURRENT_TIMESTAMP"
	res, err := PreviewCreateTable(CreateTableParams{
		Schema: "public",
		Name:   "orders",
		Columns: []CreateTableColumn{
			{Name: "id", DataType: "BIGINT", Nullable: false, PrimaryKey: true},
			{Name: "title", DataType: "TEXT", Nullable: true},
			{Name: "created_at", DataType: "TIMESTAMP", Nullable: false, Default: &def, Comment: "创建时间"},
		},
		Comment: "订单表",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.SQL) != 3 {
		t.Fatalf("len=%d sql=%v", len(res.SQL), res.SQL)
	}
	wantCreate := `CREATE TABLE "public"."orders" (
  "id" BIGINT NOT NULL,
  "title" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
)`
	if res.SQL[0] != wantCreate {
		t.Fatalf("create=\n%s", res.SQL[0])
	}
	if res.SQL[1] != `COMMENT ON TABLE "public"."orders" IS '订单表'` {
		t.Fatalf("table comment=%q", res.SQL[1])
	}
	if res.SQL[2] != `COMMENT ON COLUMN "public"."orders"."created_at" IS '创建时间'` {
		t.Fatalf("col comment=%q", res.SQL[2])
	}
}

func TestPreviewCreateTableRejectsBadType(t *testing.T) {
	_, err := PreviewCreateTable(CreateTableParams{
		Schema:  "public",
		Name:    "t",
		Columns: []CreateTableColumn{{Name: "a", DataType: "INT; DROP TABLE x", Nullable: true}},
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestPreviewCreateTableRequiresColumns(t *testing.T) {
	_, err := PreviewCreateTable(CreateTableParams{Schema: "public", Name: "t"})
	if err == nil {
		t.Fatal("expected error")
	}
}
