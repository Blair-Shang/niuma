package sqlserverparser

import (
	"strings"
	"testing"

	"niuma/pkg/sqllsp"
)

func TestLexiconNotEmpty(t *testing.T) {
	p := New()
	if len(p.Keywords()) < 50 {
		t.Fatalf("keywords too few: %d", len(p.Keywords()))
	}
	if len(p.Functions()) < 40 {
		t.Fatalf("functions too few: %d", len(p.Functions()))
	}
}

func TestCompletionIncludesKeywordAndFunction(t *testing.T) {
	p := New()
	cc := p.CompletionContext("SELECT ", sqllsp.Position{Character: 7})
	hasKw, hasFn := false, false
	for _, k := range cc.Expect {
		if k == sqllsp.KindKeyword {
			hasKw = true
		}
		if k == sqllsp.KindFunction {
			hasFn = true
		}
	}
	if !hasKw || !hasFn {
		t.Fatalf("expect keyword+function, got %#v", cc.Expect)
	}
	if len(cc.Functions) == 0 {
		t.Fatal("expected builtin function completion items")
	}
	foundGetDate := false
	for _, fn := range cc.Functions {
		if strings.EqualFold(fn.Label, "GETDATE") {
			foundGetDate = true
			break
		}
	}
	if !foundGetDate {
		t.Fatal("expected GETDATE in functions")
	}
}

func TestBuiltinSignature(t *testing.T) {
	p := New()
	sig := p.BuiltinSignature("DATEADD")
	if sig == nil || sig.Label == "" {
		t.Fatal("expected DATEADD signature")
	}
}

func TestQuoteIdent(t *testing.T) {
	p := New()
	if got := p.QuoteIdent("dbo"); got != "dbo" {
		t.Fatalf("got %q", got)
	}
	if got := p.QuoteIdent("my table"); got != "[my table]" {
		t.Fatalf("got %q", got)
	}
}
