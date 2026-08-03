package sqliteparser_test

import (
	"strings"
	"testing"

	"niuma/pkg/sqllsp"
	"niuma/services/sqlite-service/internal/sqliteparser"
)

func TestKeywordsIncludeCurrentTimestamp(t *testing.T) {
	p := sqliteparser.New()
	need := []string{"CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "CONFLICT", "RAISE"}
	have := map[string]bool{}
	for _, kw := range p.Keywords() {
		have[strings.ToUpper(kw)] = true
	}
	for _, kw := range need {
		if !have[kw] {
			t.Fatalf("missing keyword %s", kw)
		}
	}
}

func TestBuiltinDateSnippetsPreferNowLocaltime(t *testing.T) {
	p := sqliteparser.New()
	cc := p.CompletionContext("SELECT d", sqllsp.Position{Character: 8})
	byLabel := map[string]sqllsp.CompletionItem{}
	for _, fn := range cc.Functions {
		byLabel[strings.ToLower(fn.Label)] = fn
	}
	for _, name := range []string{"date", "datetime", "strftime"} {
		fn, ok := byLabel[name]
		if !ok {
			t.Fatalf("missing builtin %s", name)
		}
		if !strings.Contains(fn.InsertText, "now") {
			t.Fatalf("%s insert should default to now, got %q", name, fn.InsertText)
		}
		if !strings.Contains(fn.InsertText, "localtime") {
			t.Fatalf("%s insert should hint localtime, got %q", name, fn.InsertText)
		}
	}
	for _, name := range []string{"concat", "unhex", "json_each"} {
		if _, ok := byLabel[name]; !ok {
			t.Fatalf("missing builtin %s", name)
		}
	}
	ct, ok := byLabel["current_timestamp"]
	if !ok {
		t.Fatal("missing CURRENT_TIMESTAMP builtin")
	}
	if ct.InsertText != "CURRENT_TIMESTAMP" {
		t.Fatalf("CURRENT_TIMESTAMP should be bare, got %q", ct.InsertText)
	}
}

func TestDiagnosticsFormTypoAndIncompleteHint(t *testing.T) {
	p := sqliteparser.New()

	diags := p.Diagnostics("file.sql", "SELECT * FORM users")
	found := false
	for _, d := range diags {
		if strings.Contains(d.Message, "FROM") && d.Severity == 1 {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected FORM→FROM error, got %#v", diags)
	}

	incomplete := p.Diagnostics("file.sql", "SELECT * FROM")
	for _, d := range incomplete {
		if d.Severity == 1 {
			t.Fatalf("incomplete SELECT should not be Error, got %#v", d)
		}
	}
}

func TestTableRefAliasResolves(t *testing.T) {
	sql := `SELECT u. FROM "main"."users" u WHERE `
	refs := sqllsp.ExtractTableRefs(sql, len(sql))
	sch, tbl, ok := sqllsp.ResolveDotQualifier(refs, "u", "main")
	if !ok || tbl != "users" {
		t.Fatalf("alias u unresolved: sch=%q tbl=%q ok=%v refs=%#v", sch, tbl, ok, refs)
	}
}
