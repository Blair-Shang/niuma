package sqllsp_test

import (
	"testing"

	"niuma/pkg/sqllsp"
)

func TestParseCallSiteActiveParam(t *testing.T) {
	sql := "SELECT DATE_FORMAT(now(), "
	pos := sqllsp.OffsetToPosition(sql, len(sql))
	site := sqllsp.ParseCallSite(sql, pos)
	if site == nil {
		t.Fatal("expected call site")
	}
	if !equalFoldLocal(site.Name, "DATE_FORMAT") {
		t.Fatalf("name=%q", site.Name)
	}
	if site.ActiveParameter != 1 {
		t.Fatalf("activeParam=%d want 1", site.ActiveParameter)
	}
}

func TestParseCallSiteNestedIgnoresInner(t *testing.T) {
	// 光标在外层第二参：DATE_FORMAT(now(), |
	sql := "SELECT DATE_FORMAT(now(), x"
	pos := sqllsp.OffsetToPosition(sql, len(sql))
	site := sqllsp.ParseCallSite(sql, pos)
	if site == nil {
		t.Fatal("expected call site")
	}
	if !equalFoldLocal(site.Name, "DATE_FORMAT") {
		t.Fatalf("name=%q", site.Name)
	}
	if site.ActiveParameter != 1 {
		t.Fatalf("activeParam=%d", site.ActiveParameter)
	}
}

func TestParseCallSiteQualified(t *testing.T) {
	sql := "SELECT db.my_func(a, "
	pos := sqllsp.OffsetToPosition(sql, len(sql))
	site := sqllsp.ParseCallSite(sql, pos)
	if site == nil {
		t.Fatal("expected call site")
	}
	if site.Qualifier != "db" || !equalFoldLocal(site.Name, "my_func") {
		t.Fatalf("got %#v", site)
	}
	if site.ActiveParameter != 1 {
		t.Fatalf("activeParam=%d", site.ActiveParameter)
	}
}

func TestHeuristicCallExpectsRoutine(t *testing.T) {
	sql := "CALL my_"
	cc := sqllsp.HeuristicCompletionContext(sql, sqllsp.Position{Character: len(sql)}, nil)
	found := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindRoutine {
			found = true
		}
	}
	if !found {
		t.Fatalf("CALL should expect routine, got %#v", cc.Expect)
	}
	if cc.Prefix != "my_" {
		t.Fatalf("prefix=%q", cc.Prefix)
	}
}

func equalFoldLocal(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}
