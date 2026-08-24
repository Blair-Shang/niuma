package session

import (
	"testing"
)

func TestSanitizeCastType(t *testing.T) {
	t.Parallel()
	if got := sanitizeCastType(""); got != "text" {
		t.Fatalf("empty: got %q", got)
	}
	if got := sanitizeCastType("integer"); got != "integer" {
		t.Fatalf("integer: got %q", got)
	}
	if got := sanitizeCastType("double precision"); got != "double precision" {
		t.Fatalf("double precision: got %q", got)
	}
	if got := sanitizeCastType("numeric(10,2)"); got != "numeric(10,2)" {
		t.Fatalf("numeric: got %q", got)
	}
	if got := sanitizeCastType("text[]"); got != "text[]" {
		t.Fatalf("array: got %q", got)
	}
	if got := sanitizeCastType("int; DROP TABLE t"); got != "text" {
		t.Fatalf("injection: got %q", got)
	}
}

func TestBuildFunctionSelectSQL(t *testing.T) {
	t.Parallel()
	args := []RoutineCallArg{
		{Name: "a", Type: "integer", Mode: "in", Value: "1"},
		{Name: "b", Type: "text", Mode: "out"},
		{Name: "c", Type: "varchar", Mode: "inout", Value: "x"},
	}
	sql, bind := buildFunctionSelectSQL(`"public"."fn"`, args, true)
	want := `SELECT * FROM "public"."fn"($1::integer, $2::varchar)`
	if sql != want {
		t.Fatalf("sql: got %q want %q", sql, want)
	}
	if len(bind) != 2 {
		t.Fatalf("bind len=%d", len(bind))
	}
	if bind[0] != "1" || bind[1] != "x" {
		t.Fatalf("bind=%v", bind)
	}

	sql, _ = buildFunctionSelectSQL(`"public"."fn"`, args, false)
	want = `SELECT "public"."fn"($1::integer, $2::varchar)`
	if sql != want {
		t.Fatalf("scalar sql: got %q want %q", sql, want)
	}
}

func TestBuildProcedureCallSQL(t *testing.T) {
	t.Parallel()
	sql, bind := buildProcedureCallSQL(`"s"."p"`, []RoutineCallArg{
		{Name: "id", Type: "bigint", Mode: "in", Value: "9"},
		{Name: "flag", Type: "boolean", Mode: "in", IsNull: true},
	})
	want := `CALL "s"."p"($1::bigint, $2::boolean)`
	if sql != want {
		t.Fatalf("sql: got %q want %q", sql, want)
	}
	if len(bind) != 2 || bind[0] != "9" || bind[1] != nil {
		t.Fatalf("bind=%v", bind)
	}
}

func TestFunctionUsesFromClause(t *testing.T) {
	t.Parallel()
	if functionUsesFromClause(routineCallMeta{voidRet: true, kind: "function"}) {
		t.Fatal("void should not use FROM")
	}
	if !functionUsesFromClause(routineCallMeta{setRet: true, kind: "function"}) {
		t.Fatal("set-returning should use FROM")
	}
	if !functionUsesFromClause(routineCallMeta{composite: true, kind: "function"}) {
		t.Fatal("composite should use FROM")
	}
	if functionUsesFromClause(routineCallMeta{kind: "function"}) {
		t.Fatal("scalar should not use FROM")
	}
	if !functionUsesFromClause(routineCallMeta{}) {
		t.Fatal("unknown should default to FROM")
	}
}

func TestNormalizeKind(t *testing.T) {
	t.Parallel()
	if got := normalizeKind("FUNCTION", nil); got != "function" {
		t.Fatalf("got %q", got)
	}
	if got := normalizeKind("", []RoutineCallArg{{Mode: "out"}}); got != "procedure" {
		t.Fatalf("legacy out: got %q", got)
	}
	if got := normalizeKind("", nil); got != "" {
		t.Fatalf("empty: got %q", got)
	}
}
