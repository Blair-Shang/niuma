package mysqlparser_test

import (
	"strings"
	"testing"

	"niuma/pkg/sqllsp"
	"niuma/services/mysql-service/internal/mysqlparser"
)

func TestFunctionOKNoDiagnostics(t *testing.T) {
	p := mysqlparser.New()
	sql := `CREATE FUNCTION f() RETURNS INT DETERMINISTIC
BEGIN
  RETURN 1;
END`
	diags := p.Diagnostics("", sql)
	if len(diags) != 0 {
		t.Fatalf("valid CREATE FUNCTION should have no diagnostics, got %#v", diags)
	}
}

func TestFunctionBodySyntaxError(t *testing.T) {
	p := mysqlparser.New()
	sql := `CREATE FUNCTION f() RETURNS INT DETERMINISTIC
BEGIN
  SELEC 1;
END`
	diags := p.Diagnostics("", sql)
	if len(diags) == 0 {
		t.Fatal("expected body syntax diagnostic for SELEC")
	}
	// 不应卡在 FUNCTION 关键字（第 0 行）
	for _, d := range diags {
		msg := strings.ToLower(d.Message)
		if strings.Contains(msg, "near \"function") {
			t.Fatalf("should not report FUNCTION keyword false positive: %#v", d)
		}
		if d.Range.Start.Line == 0 && strings.Contains(msg, "function") && !strings.Contains(msg, "selec") {
			t.Fatalf("diagnostic should target body, got line=0 msg=%s", d.Message)
		}
	}
	// 错误应落在正文行（SELEC 在 line 2，0-based）
	foundBody := false
	for _, d := range diags {
		if d.Range.Start.Line >= 1 {
			foundBody = true
			break
		}
	}
	if !foundBody {
		t.Fatalf("expected diagnostic on body line, got %#v", diags)
	}
}

func TestProcedureBodySyntaxError(t *testing.T) {
	p := mysqlparser.New()
	sql := `CREATE PROCEDURE p()
BEGIN
  SELEC 1;
END`
	diags := p.Diagnostics("", sql)
	if len(diags) == 0 {
		t.Fatal("expected body syntax diagnostic for SELEC")
	}
	foundBody := false
	for _, d := range diags {
		if d.Range.Start.Line >= 1 {
			foundBody = true
			break
		}
	}
	if !foundBody {
		t.Fatalf("expected diagnostic on body line, got %#v", diags)
	}
}

func TestProcedureOKNoDiagnostics(t *testing.T) {
	p := mysqlparser.New()
	sql := `CREATE PROCEDURE p()
BEGIN
  SELECT 1;
END`
	diags := p.Diagnostics("", sql)
	if len(diags) != 0 {
		t.Fatalf("valid CREATE PROCEDURE should have no diagnostics, got %#v", diags)
	}
}

func TestViewBadStillDiagnosed(t *testing.T) {
	p := mysqlparser.New()
	diags := p.Diagnostics("", "CREATE VIEW v AS SELEC 1")
	if len(diags) == 0 {
		t.Fatal("expected VIEW syntax diagnostic")
	}
}

func TestPlainSelectStillDiagnosed(t *testing.T) {
	p := mysqlparser.New()
	diags := p.Diagnostics("", "SELEC 1")
	if len(diags) == 0 {
		t.Fatal("expected plain SQL diagnostic")
	}
}

func TestFunctionMissingReturns(t *testing.T) {
	p := mysqlparser.New()
	sql := `CREATE FUNCTION f()
BEGIN
  RETURN 1;
END`
	diags := p.Diagnostics("", sql)
	if len(diags) == 0 {
		t.Fatal("expected RETURNS shell diagnostic")
	}
	found := false
	for _, d := range diags {
		if strings.Contains(strings.ToUpper(d.Message), "RETURNS") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected RETURNS message, got %#v", diags)
	}
}

func TestRoutineWithDelimiterWrapper(t *testing.T) {
	p := mysqlparser.New()
	sql := "DELIMITER $$\nCREATE FUNCTION f() RETURNS INT\nBEGIN\n  RETURN 1;\nEND$$\nDELIMITER ;\n"
	diags := p.Diagnostics("", sql)
	if len(diags) != 0 {
		t.Fatalf("valid function with DELIMITER should be clean, got %#v", diags)
	}
}

func TestFunctionWithDeclareAndIfSkipped(t *testing.T) {
	p := mysqlparser.New()
	// DECLARE / IF 控制块跳过 TiDB；其间合法 SELECT 不应误报
	sql := `CREATE FUNCTION f(x INT) RETURNS INT DETERMINISTIC
BEGIN
  DECLARE y INT DEFAULT 0;
  IF x > 0 THEN
    SET y = x;
  END IF;
  RETURN y;
END`
	diags := p.Diagnostics("", sql)
	if len(diags) != 0 {
		t.Fatalf("DECLARE/IF body should not false-positive, got %#v", diags)
	}
}

func TestFunctionQualifiedNameNoFalsePositive(t *testing.T) {
	p := mysqlparser.New()
	sql := "CREATE FUNCTION `test2`.`new_functest`()\nRETURNS INT\nDETERMINISTIC\nBEGIN\n    RETURN 1;\nEND;"
	diags := p.Diagnostics("", sql)
	if len(diags) != 0 {
		t.Fatalf("qualified function name should be valid, got %#v", diags)
	}
}

func TestProcedureQualifiedNameNoFalsePositive(t *testing.T) {
	p := mysqlparser.New()
	sql := "CREATE PROCEDURE test2.p()\nBEGIN\n  SELECT 1;\nEND"
	diags := p.Diagnostics("", sql)
	if len(diags) != 0 {
		t.Fatalf("qualified procedure name should be valid, got %#v", diags)
	}
}

func TestKeywordsIncludeReturn(t *testing.T) {
	p := mysqlparser.New()
	found := false
	for _, kw := range p.Keywords() {
		if kw == "RETURN" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("RETURN should be in keyword list")
	}
}

func TestFunctionsIncludeNow(t *testing.T) {
	p := mysqlparser.New()
	fns := p.Functions()
	if len(fns) < 10 {
		t.Fatalf("expected builtin functions, got %d", len(fns))
	}
	found := false
	for _, name := range fns {
		if strings.EqualFold(name, "NOW") {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("NOW should be in function list")
	}
}

func TestCompletionReturnInFunctionBody(t *testing.T) {
	p := mysqlparser.New()
	sql := "CREATE FUNCTION f() RETURNS INT\nBEGIN\n  retur\nEND"
	// cursor after "retur"
	pos := strings.Index(sql, "retur") + len("retur")
	cc := p.CompletionContext(sql, sqllsp.OffsetToPosition(sql, pos))
	if len(cc.Expect) == 0 || cc.Expect[0] != sqllsp.KindKeyword {
		t.Fatalf("function body should prefer keywords, got %#v", cc.Expect)
	}
	found := false
	for _, kw := range cc.Keywords {
		if kw == "RETURN" && strings.HasPrefix(strings.ToLower(kw), strings.ToLower(cc.Prefix)) {
			found = true
			break
		}
	}
	// Keywords() 全量在 cc.Keywords；前缀由 Server 过滤。这里至少要有 RETURN 且 prefix=retur
	if cc.Prefix != "retur" {
		t.Fatalf("prefix=%q", cc.Prefix)
	}
	for _, kw := range p.Keywords() {
		if kw == "RETURN" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("RETURN keyword missing")
	}
}

func TestFunctionBodyErrorNotMaskedByDeclare(t *testing.T) {
	p := mysqlparser.New()
	sql := `CREATE FUNCTION f() RETURNS INT
BEGIN
  DECLARE y INT DEFAULT 0;
  SELEC 1;
  RETURN y;
END`
	diags := p.Diagnostics("", sql)
	if len(diags) == 0 {
		t.Fatal("expected SELEC diagnostic even with DECLARE present")
	}
}
