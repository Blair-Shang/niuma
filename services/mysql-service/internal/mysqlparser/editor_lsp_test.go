package mysqlparser_test

import (
	"strings"
	"testing"

	"niuma/pkg/sqllsp"
	"niuma/services/mysql-service/internal/mysqlparser"
)

func TestBuiltinFunctionsIncludeNOW(t *testing.T) {
	p := mysqlparser.New()
	cc := p.CompletionContext("SELECT n", sqllsp.Position{Character: 8})
	foundFn := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindFunction {
			foundFn = true
		}
	}
	if !foundFn {
		t.Fatalf("SELECT list should expect functions, got %#v", cc.Expect)
	}
	foundNOW := false
	foundDateFormat := false
	for _, fn := range cc.Functions {
		if strings.EqualFold(fn.Label, "NOW") {
			foundNOW = true
			if fn.Kind != sqllsp.LSPKindFunction {
				t.Fatalf("NOW kind=%d", fn.Kind)
			}
			if !strings.Contains(fn.InsertText, "NOW") {
				t.Fatalf("NOW insert=%q", fn.InsertText)
			}
		}
		if strings.EqualFold(fn.Label, "DATE_FORMAT") {
			foundDateFormat = true
			if !strings.Contains(fn.InsertText, "${") {
				t.Fatalf("DATE_FORMAT should be snippet-like, got %q", fn.InsertText)
			}
		}
	}
	if !foundNOW {
		t.Fatal("expected NOW in builtin functions")
	}
	if !foundDateFormat {
		t.Fatal("expected DATE_FORMAT in builtin functions")
	}
}

func TestLocalNamesFromProcedure(t *testing.T) {
	p := mysqlparser.New()
	sql := `CREATE PROCEDURE p(IN a INT, OUT b VARCHAR(10))
BEGIN
  DECLARE x INT DEFAULT 0;
  DECLARE y, z INT;
  SET x = a;
END`
	names := p.LocalNames(sql)
	want := map[string]bool{"a": false, "b": false, "x": false, "y": false, "z": false}
	for _, n := range names {
		if _, ok := want[strings.ToLower(n)]; ok {
			want[strings.ToLower(n)] = true
		}
	}
	for k, ok := range want {
		if !ok {
			t.Fatalf("missing local %q in %#v", k, names)
		}
	}

	cc := p.CompletionContext(sql, sqllsp.OffsetToPosition(sql, strings.Index(sql, "SET x")+4))
	if len(cc.Locals) < 3 {
		t.Fatalf("completion locals=%#v", cc.Locals)
	}
}

func TestDocumentSymbolsProcedureAndSelect(t *testing.T) {
	p := mysqlparser.New()
	sql := `CREATE PROCEDURE demo_proc(IN id INT)
BEGIN
  SELECT 1;
END;
SELECT 2;`
	syms := p.DocumentSymbols(sql)
	foundProc := false
	foundSelect := false
	for _, s := range syms {
		if strings.EqualFold(s.Name, "demo_proc") {
			foundProc = true
		}
		if s.Name == "SELECT" {
			foundSelect = true
		}
	}
	if !foundProc {
		t.Fatalf("expected procedure symbol, got %#v", syms)
	}
	if !foundSelect {
		t.Fatalf("expected SELECT symbol, got %#v", syms)
	}
}

func TestDefinitionLocalJump(t *testing.T) {
	p := mysqlparser.New()
	sql := `CREATE FUNCTION f(a INT) RETURNS INT
DETERMINISTIC
BEGIN
  DECLARE total INT DEFAULT 0;
  RETURN total + a;
END`
	idx := strings.LastIndex(sql, "total")
	pos := sqllsp.OffsetToPosition(sql, idx+2)
	target := p.DefinitionTarget(sql, pos)
	if target == nil || target.Kind != "local" {
		t.Fatalf("expected local definition, got %#v", target)
	}
	if !strings.EqualFold(target.Name, "total") {
		t.Fatalf("name=%q", target.Name)
	}
}

func TestBuiltinSignatureDATE_FORMAT(t *testing.T) {
	p := mysqlparser.New()
	sig := p.BuiltinSignature("DATE_FORMAT")
	if sig == nil {
		t.Fatal("expected signature")
	}
	if len(sig.Parameters) < 2 {
		t.Fatalf("params=%#v", sig.Parameters)
	}
	if !strings.Contains(sig.Label, "DATE_FORMAT(") {
		t.Fatalf("label=%q", sig.Label)
	}
}

func TestCompletionCallExpectsRoutine(t *testing.T) {
	p := mysqlparser.New()
	cc := p.CompletionContext("CALL demo", sqllsp.Position{Character: 9})
	found := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindRoutine {
			found = true
		}
	}
	if !found {
		t.Fatalf("expect routine after CALL, got %#v", cc.Expect)
	}
}
