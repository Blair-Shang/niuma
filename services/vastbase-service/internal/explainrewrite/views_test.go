package explainrewrite

import (
	"testing"
)

func TestFindQualifiedRefs(t *testing.T) {
	sql := `SELECT * FROM "public"."new_view" WHERE true LIMIT 100`
	refs := findQualifiedRefs(sql)
	if len(refs) != 1 {
		t.Fatalf("refs=%v", refs)
	}
	if refs[0].Schema != "public" || refs[0].Name != "new_view" {
		t.Fatalf("got %+v", refs[0])
	}
}

func TestFindQualifiedRefsSkipsStringLiteral(t *testing.T) {
	sql := `SELECT 'public.new_view' AS x FROM "public"."bas_sku"`
	refs := findQualifiedRefs(sql)
	if len(refs) != 1 || refs[0].Name != "bas_sku" {
		t.Fatalf("refs=%v", refs)
	}
}

func TestReplaceQualifiedRelation(t *testing.T) {
	sql := `SELECT * FROM "public"."new_view" WHERE true`
	got := replaceQualifiedRelation(sql, "public", "new_view", `(SELECT 1) AS "new_view"`)
	want := `SELECT * FROM (SELECT 1) AS "new_view" WHERE true`
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestReplacePlainQualifiedRelation(t *testing.T) {
	sql := `SELECT * FROM public.new_view`
	got := replaceQualifiedRelation(sql, "public", "new_view", `(SELECT 1) AS "new_view"`)
	want := `SELECT * FROM (SELECT 1) AS "new_view"`
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestStripTrailingSemicolon(t *testing.T) {
	if got := stripTrailingSemicolon("SELECT 1;\n"); got != "SELECT 1" {
		t.Fatalf("got %q", got)
	}
}
