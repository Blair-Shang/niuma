package clickhouseparser

import (
	"strings"
	"testing"

	"niuma/pkg/sqllsp"
)

func TestKeywordsNonEmpty(t *testing.T) {
	t.Parallel()
	p := New()
	if len(p.Keywords()) < 200 {
		t.Fatalf("keywords too few: %d", len(p.Keywords()))
	}
	if len(p.Functions()) < 150 {
		t.Fatalf("functions too few: %d", len(p.Functions()))
	}
	// 抽样：近年语法 / 类型 / 引擎应在词表中
	need := []string{"QUALIFY", "PREWHERE", "MergeTree", "UInt64", "Nullable", "SETTINGS", "FORMAT"}
	have := map[string]bool{}
	for _, k := range p.Keywords() {
		have[k] = true
	}
	for _, k := range need {
		if !have[k] {
			t.Fatalf("missing keyword %q", k)
		}
	}
	fnNeed := []string{"toYYYYMM", "uniqExact", "JSONExtract", "arrayMap", "dictGet", "numbers"}
	fnHave := map[string]bool{}
	for _, f := range p.Functions() {
		fnHave[f] = true
	}
	for _, f := range fnNeed {
		if !fnHave[f] {
			t.Fatalf("missing function %q", f)
		}
	}
}

func TestQuoteIdent(t *testing.T) {
	t.Parallel()
	p := New()
	if got := p.QuoteIdent("a`b"); got != "`a``b`" {
		t.Fatalf("QuoteIdent=%q", got)
	}
}

func TestCompletionContextSelect(t *testing.T) {
	t.Parallel()
	p := New()
	text := "SELECT * FROM "
	cc := p.CompletionContext(text, offsetPos(text, len(text)))
	if len(cc.Expect) == 0 && len(cc.Keywords) == 0 {
		t.Fatal("expected completion context")
	}
}

func TestDiagnosticsTypoFORM(t *testing.T) {
	t.Parallel()
	p := New()
	diags := p.Diagnostics("file:///x.sql", "SELECT * FORM t")
	found := false
	for _, d := range diags {
		if strings.Contains(d.Message, "FROM") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected FORM typo diagnostic, got %#v", diags)
	}
}

func offsetPos(text string, offset int) sqllsp.Position {
	line, col := 0, 0
	for i := 0; i < offset && i < len(text); i++ {
		if text[i] == '\n' {
			line++
			col = 0
		} else {
			col++
		}
	}
	return sqllsp.Position{Line: line, Character: col}
}
