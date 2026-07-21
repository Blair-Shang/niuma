package ddl

import (
	"strings"
	"testing"
)

func TestPreviewDesignAddPrimaryKeyAndIndex(t *testing.T) {
	uniq := true
	res, err := PreviewDesign(DesignPreviewParams{
		Schema: "public",
		Name:   "orders",
		Ops: []DesignOp{
			{Op: DesignAddPrimaryKey, Columns: []string{"id"}},
			{
				Op: DesignAddIndex, Name: "idx_orders_title", Columns: []string{"title"},
				Unique: &uniq, Where: "title IS NOT NULL",
			},
			{
				Op: DesignAddIndex, Name: "idx_lower_name", Expression: "lower(name)",
			},
			{
				Op: DesignAddIndex, Name: "idx_gin", Expression: "data", Method: "gin",
			},
			{Op: DesignAddCheck, Name: "chk_positive", Expression: "id > 0"},
			{
				Op: DesignAddForeignKey, Name: "fk_orders_user", Columns: []string{"user_id"},
				RefSchema: "public", RefTable: "users", RefColumns: []string{"id"},
				OnDelete: "CASCADE", OnUpdate: "RESTRICT",
			},
			{Op: DesignDropIndex, Name: "old_idx"},
			{Op: DesignRenameIndex, Name: "a", NewName: "b"},
			{Op: DesignSetTableComment, Comment: "订单"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.SQL) != 9 {
		t.Fatalf("len=%d %v", len(res.SQL), res.SQL)
	}
	if res.SQL[1] != `CREATE UNIQUE INDEX "idx_orders_title" ON "public"."orders" ("title") WHERE title IS NOT NULL` {
		t.Fatalf("partial=%q", res.SQL[1])
	}
	if res.SQL[2] != `CREATE INDEX "idx_lower_name" ON "public"."orders" (lower(name))` {
		t.Fatalf("expr=%q", res.SQL[2])
	}
	if res.SQL[3] != `CREATE INDEX "idx_gin" ON "public"."orders" USING gin (data)` {
		t.Fatalf("gin=%q", res.SQL[3])
	}
	if res.SQL[4] != `ALTER TABLE "public"."orders" ADD CONSTRAINT "chk_positive" CHECK (id > 0)` {
		t.Fatalf("check=%q", res.SQL[4])
	}
	if !strings.Contains(res.SQL[5], `ON DELETE CASCADE`) || !strings.Contains(res.SQL[5], `ON UPDATE RESTRICT`) {
		t.Fatalf("fk=%q", res.SQL[5])
	}
	if res.SQL[7] != `ALTER INDEX "public"."a" RENAME TO "b"` {
		t.Fatalf("rename=%q", res.SQL[7])
	}
}

func TestPreviewCreateTableWithIndexAndFK(t *testing.T) {
	res, err := PreviewCreateTable(CreateTableParams{
		Schema: "public",
		Name:   "orders",
		Columns: []CreateTableColumn{
			{Name: "id", DataType: "BIGINT", Nullable: false, PrimaryKey: true},
			{Name: "user_id", DataType: "BIGINT", Nullable: false},
			{Name: "payload", DataType: "JSONB", Nullable: true},
		},
		Indexes: []CreateTableIndex{
			{Name: "idx_orders_user", Columns: []string{"user_id"}, Where: "user_id > 0"},
			{Name: "idx_payload", Expression: "payload", Method: "gin"},
		},
		Checks: []CreateTableCheck{
			{Name: "chk_uid", Expression: "user_id > 0"},
		},
		ForeignKeys: []CreateTableForeignKey{
			{
				Columns: []string{"user_id"}, RefTable: "users", RefColumns: []string{"id"},
				OnDelete: "SET NULL",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.SQL) != 5 {
		t.Fatalf("len=%d %v", len(res.SQL), res.SQL)
	}
	if !strings.Contains(res.SQL[1], `WHERE user_id > 0`) {
		t.Fatalf("idx=%q", res.SQL[1])
	}
	if res.SQL[2] != `CREATE INDEX "idx_payload" ON "public"."orders" USING gin (payload)` {
		t.Fatalf("gin=%q", res.SQL[2])
	}
	if res.SQL[3] != `ALTER TABLE "public"."orders" ADD CONSTRAINT "chk_uid" CHECK (user_id > 0)` {
		t.Fatalf("check=%q", res.SQL[3])
	}
	if !strings.Contains(res.SQL[4], `ON DELETE SET NULL`) {
		t.Fatalf("fk=%q", res.SQL[4])
	}
}
