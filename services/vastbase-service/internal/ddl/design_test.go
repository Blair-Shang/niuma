package ddl

import "testing"

func TestPreviewDesignAddAndRename(t *testing.T) {
	def := "0"
	res, err := PreviewDesign(DesignPreviewParams{
		Schema: "public",
		Name:   "t",
		Ops: []DesignOp{
			{Op: DesignAddColumn, Name: "c1", DataType: "INT", Default: &def},
			{Op: DesignRenameColumn, Name: "old", NewName: "new"},
			{Op: DesignSetNotNull, Name: "c1"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.SQL) != 3 {
		t.Fatalf("len=%d", len(res.SQL))
	}
	if res.SQL[0] != `ALTER TABLE "public"."t" ADD COLUMN "c1" INT DEFAULT 0` {
		t.Fatalf("add=%q", res.SQL[0])
	}
	if res.SQL[1] != `ALTER TABLE "public"."t" RENAME COLUMN "old" TO "new"` {
		t.Fatalf("rename=%q", res.SQL[1])
	}
}
