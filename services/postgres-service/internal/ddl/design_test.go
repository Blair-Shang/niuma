package ddl

import (
	"strings"
	"testing"
)

func TestBuildDesignSQLAlterTypeUsesCast(t *testing.T) {
	t.Parallel()

	sql, err := buildDesignSQL("public", "new_table", DesignOp{
		Op:       DesignAlterType,
		Name:     "col_4",
		DataType: "BIGINT",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `ALTER TABLE "public"."new_table" ALTER COLUMN "col_4" TYPE BIGINT USING CAST("col_4" AS BIGINT)`
	if sql != want {
		t.Fatalf("sql=%q want=%q", sql, want)
	}
}

func TestBuildDesignSQLAlterTypeRejectsInjectedType(t *testing.T) {
	t.Parallel()

	_, err := buildDesignSQL("public", "t", DesignOp{
		Op:       DesignAlterType,
		Name:     "c",
		DataType: "BIGINT; DROP TABLE t",
	})
	if err == nil || !strings.Contains(err.Error(), "forbidden") {
		t.Fatalf("err=%v", err)
	}
}
