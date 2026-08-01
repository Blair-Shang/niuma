package kingbaseparser_test

import (
	"strings"
	"testing"

	"niuma/pkg/sqllsp"
	"niuma/services/kingbase-service/internal/kingbaseparser"
)

func TestKeywordsNonEmpty(t *testing.T) {
	p := kingbaseparser.New()
	if len(p.Keywords()) < 20 {
		t.Fatal("expected kingbase keywords")
	}
}

func TestClassify(t *testing.T) {
	cases := []struct {
		sql  string
		kind string
	}{
		{"SELECT 1", "select"},
		{"WITH a AS (SELECT 1) SELECT * FROM a", "select"},
		{"INSERT INTO t VALUES (1)", "insert"},
		{"UPDATE t SET a=1", "update"},
		{"DELETE FROM t", "delete"},
		{"MERGE INTO t USING s ON (1=1) WHEN MATCHED THEN UPDATE SET a=1", "merge"},
		{"CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;", "create_procedure"},
		{"CREATE OR REPLACE FUNCTION f RETURN INT AS BEGIN RETURN 1; END;", "create_function"},
		{"CREATE TABLE t (id INT)", "create_table"},
	}
	for _, c := range cases {
		got := kingbaseparser.Classify(c.sql).String()
		if got != c.kind {
			t.Fatalf("%q: got %s want %s", c.sql, got, c.kind)
		}
	}
}

func TestDiagnosticsTypoFORM(t *testing.T) {
	p := kingbaseparser.New()
	diags := p.Diagnostics("u", "SELECT * FORM t;")
	if len(diags) == 0 {
		t.Fatal("expected typo diagnostic for FORM")
	}
	found := false
	for _, d := range diags {
		if d.Severity == 1 && strings.Contains(d.Message, "FROM") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected FORM→FROM error, got %#v", diags)
	}
}

func TestDiagnosticsIncompleteHint(t *testing.T) {
	p := kingbaseparser.New()
	diags := p.Diagnostics("u", "SELECT * FROM ")
	for _, d := range diags {
		if d.Severity == 1 {
			t.Fatalf("incomplete SELECT must not be Error, got %#v", d)
		}
	}
}

func TestDiagnosticsFromExtraIdent(t *testing.T) {
	p := kingbaseparser.New()
	sql := "SELECT organizationid,activeflag from BAS_CUSTOMER s ew"
	diags := p.Diagnostics("u", sql)
	found := false
	for _, d := range diags {
		if d.Severity == 1 && strings.Contains(d.Message, "unexpected token") {
			found = true
			// ew 约在第 53–54 列（与服务端语法错误对齐）
			if d.Range.Start.Character < 50 {
				t.Fatalf("expected error near ew, got range %#v", d.Range)
			}
		}
	}
	if !found {
		t.Fatalf("expected unexpected token after table reference, got %#v", diags)
	}
}

func TestDiagnosticsFromAliasOK(t *testing.T) {
	p := kingbaseparser.New()
	for _, sql := range []string{
		"SELECT * FROM BAS_CUSTOMER s",
		"SELECT * FROM BAS_CUSTOMER AS s WHERE 1=1",
		"SELECT * FROM a s JOIN b t ON a.id=b.id",
		"SELECT * FROM a, b",
	} {
		for _, d := range p.Diagnostics("u", sql) {
			if d.Severity == 1 && strings.Contains(d.Message, "unexpected token") {
				t.Fatalf("false positive on %q: %#v", sql, d)
			}
		}
	}
}

func TestDiagnosticsIncompleteWhereEquals(t *testing.T) {
	p := kingbaseparser.New()
	sql := "SELECT * FROM BAS_CUSTOMER aa WHERE activeflag="
	diags := p.Diagnostics("u", sql)
	found := false
	for _, d := range diags {
		if d.Severity == 2 && strings.Contains(d.Message, "incomplete expression") {
			found = true
		}
		if d.Severity == 1 {
			t.Fatalf("incomplete WHERE must not be Error, got %#v", d)
		}
	}
	if !found {
		t.Fatalf("expected Warning for trailing '=', got %#v", diags)
	}
}

func TestDiagnosticsIncompleteTrailingKeyword(t *testing.T) {
	p := kingbaseparser.New()
	diags := p.Diagnostics("u", "SELECT * FROM BAS_CUSTOMER WHERE")
	found := false
	for _, d := range diags {
		if d.Severity == 2 && strings.Contains(d.Message, "WHERE") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected Warning for trailing WHERE, got %#v", diags)
	}
}

func TestDiagnosticsUnknownLeadUpBasSkuSet(t *testing.T) {
	p := kingbaseparser.New()
	diags := p.Diagnostics("u", "up bas_sku set")
	lead := false
	tail := false
	for _, d := range diags {
		if d.Severity == 1 && strings.Contains(d.Message, "UPDATE") {
			lead = true
		}
		if d.Severity == 2 && strings.Contains(d.Message, "SET") {
			tail = true
		}
	}
	if !lead {
		t.Fatalf("expected Error suggesting UPDATE for leading 'up', got %#v", diags)
	}
	if !tail {
		t.Fatalf("expected Warning for trailing SET, got %#v", diags)
	}
}

func TestDiagnosticsUnknownLeadDoesNotFlagBareIdent(t *testing.T) {
	p := kingbaseparser.New()
	// 单独标识符、无 DML 形状 → 不报首词 Error（避免误伤）
	for _, d := range p.Diagnostics("u", "bas_sku") {
		if d.Severity == 1 && strings.Contains(d.Message, "did you mean") {
			t.Fatalf("unexpected lead suggestion on bare ident: %#v", d)
		}
	}
}

func TestDiagnosticsCompleteSelectNoIncompleteWarn(t *testing.T) {
	p := kingbaseparser.New()
	sql := "SELECT * FROM BAS_CUSTOMER aa WHERE activeflag = 'Y'"
	for _, d := range p.Diagnostics("u", sql) {
		if strings.Contains(d.Message, "incomplete") {
			t.Fatalf("false incomplete on valid SQL: %#v", d)
		}
	}
}

func TestDiagnosticsInsertRequiresInto(t *testing.T) {
	p := kingbaseparser.New()
	diags := p.Diagnostics("u", "INSERT t VALUES (1);")
	found := false
	for _, d := range diags {
		if strings.Contains(d.Message, "INTO") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected INSERT INTO diagnostic, got %#v", diags)
	}
}

func TestDiagnosticsUpdateRequiresSet(t *testing.T) {
	p := kingbaseparser.New()
	diags := p.Diagnostics("u", "UPDATE t WHERE id=1;")
	found := false
	for _, d := range diags {
		if strings.Contains(d.Message, "SET") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected UPDATE SET diagnostic, got %#v", diags)
	}
}

func TestRoutineShellIncompleteHint(t *testing.T) {
	p := kingbaseparser.New()
	diags := p.Diagnostics("u", "CREATE OR REPLACE PROCEDURE p")
	if len(diags) == 0 {
		t.Fatal("expected incomplete procedure hint")
	}
	if diags[0].Severity != 4 {
		t.Fatalf("expected Hint, got severity %d msg=%s", diags[0].Severity, diags[0].Message)
	}
}

func TestRoutineShellUnclosedBegin(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PROCEDURE p AS\nBEGIN\n\tNULL;\n"
	diags := p.Diagnostics("u", sql)
	found := false
	for _, d := range diags {
		if strings.Contains(d.Message, "BEGIN") {
			found = true
			if d.Severity != 4 {
				t.Fatalf("unclosed BEGIN while incomplete should be Hint, got %d", d.Severity)
			}
		}
	}
	if !found {
		t.Fatalf("expected unclosed BEGIN hint, got %#v", diags)
	}
}

func TestRoutineBodyTypo(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PROCEDURE p AS\nBEGIN\n\tSELECT * FORM t;\nEND;\n/"
	diags := p.Diagnostics("u", sql)
	found := false
	for _, d := range diags {
		if strings.Contains(d.Message, "FROM") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected body FORM typo, got %#v", diags)
	}
}

func TestRoutineBodyMissingSemicolonBeforeAssign(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PROCEDURE p AS\nBEGIN\n" +
		"\tSELECT * FROM t where ac\n" +
		"\to_greet := 'x';\n" +
		"END;"
	diags := p.Diagnostics("u", sql)
	foundSemi, foundInto := false, false
	for _, d := range diags {
		if d.Severity != 1 {
			continue
		}
		if strings.Contains(d.Message, "missing semicolon") {
			foundSemi = true
		}
		if strings.Contains(d.Message, "INTO") {
			foundInto = true
		}
	}
	if !foundSemi {
		t.Fatalf("expected missing-semicolon error, got %#v", diags)
	}
	if !foundInto {
		t.Fatalf("expected SELECT…INTO error, got %#v", diags)
	}
}

func TestRoutineBodySelectIntoOK(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PROCEDURE p AS\nBEGIN\n\tSELECT name INTO v FROM t WHERE id = 1;\nEND;"
	for _, d := range p.Diagnostics("u", sql) {
		if strings.Contains(d.Message, "INTO") || strings.Contains(d.Message, "semicolon") {
			t.Fatalf("unexpected diagnostic: %#v", d)
		}
	}
}

func TestCompletionContextFrom(t *testing.T) {
	p := kingbaseparser.New()
	cc := p.CompletionContext("SELECT * FROM u", sqllsp.Position{Character: 15})
	foundTable := false
	for _, k := range cc.Expect {
		if k == sqllsp.KindTable || k == sqllsp.KindSchema {
			foundTable = true
		}
	}
	if !foundTable {
		t.Fatalf("expect table/schema after FROM, got %#v", cc)
	}
}

func TestCompletionContextSelectColumn(t *testing.T) {
	sql := "SELECT * FROM users WHERE "
	cc := kingbaseparser.New().CompletionContext(sql, sqllsp.Position{Character: len(sql)})
	for _, kind := range cc.Expect {
		if kind == sqllsp.KindColumn {
			return
		}
	}
	t.Fatalf("expected column completion in SELECT predicate, got %#v", cc.Expect)
}

func TestCompletionSnippetsNoDelimiter(t *testing.T) {
	p := kingbaseparser.New()
	cc := p.CompletionContext("CREATE ", sqllsp.Position{Character: 7})
	if len(cc.Snippets) == 0 {
		t.Fatal("expected create snippets")
	}
	for _, sn := range cc.Snippets {
		if strings.Contains(strings.ToUpper(sn.InsertText), "DELIMITER") {
			t.Fatalf("kingbase snippet must not use DELIMITER: %s", sn.Label)
		}
		if strings.Contains(sn.InsertText, "`") {
			t.Fatalf("kingbase snippet must use double-quote ident, got backtick in %s", sn.Label)
		}
	}
}

func TestCompletionLocalsFromDeclare(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PROCEDURE p(v_id INT)\nAS\nv_name VARCHAR(32);\nBEGIN\n\t"
	cc := p.CompletionContext(sql, sqllsp.Position{Line: 3, Character: 1})
	joined := strings.ToLower(strings.Join(cc.Locals, ","))
	if !strings.Contains(joined, "v_id") || !strings.Contains(joined, "v_name") {
		t.Fatalf("expected locals v_id,v_name got %#v", cc.Locals)
	}
}

func TestWorkASTTables(t *testing.T) {
	sql := "SELECT a.id FROM emp a JOIN dept b ON a.dept_id=b.id WHERE "
	ast := kingbaseparser.ParseWorkAST(sql, sqllsp.Position{Character: len(sql)})
	if len(ast.Tables) < 2 {
		t.Fatalf("expected >=2 table refs, got %#v", ast.Tables)
	}
}

func TestCompatOracleLimitHint(t *testing.T) {
	p := kingbaseparser.NewWithCompat(kingbaseparser.CompatOracle)
	diags := p.Diagnostics("u", "SELECT * FROM t LIMIT 10;")
	found := false
	for _, d := range diags {
		if d.Severity == 4 && strings.Contains(d.Message, "ROWNUM") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected Oracle LIMIT hint, got %#v", diags)
	}
}

func TestDocumentSymbolsProcedure(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PROCEDURE demo_p AS\nBEGIN\n\tNULL;\nEND;\n/"
	syms := p.DocumentSymbols(sql)
	if len(syms) == 0 || !strings.EqualFold(syms[0].Name, "demo_p") {
		t.Fatalf("expected procedure symbol demo_p, got %#v", syms)
	}
}

func TestDefinitionLocal(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PROCEDURE p(v_id INT)\nAS\nBEGIN\n\tv_id := 1;\nEND;\n/"
	// 光标落在体内 v_id
	pos := sqllsp.Position{Line: 3, Character: 2}
	target := p.DefinitionTarget(sql, pos)
	if target == nil || target.Kind != "local" {
		t.Fatalf("expected local definition, got %#v", target)
	}
}

func TestFormatCollapsesBlankLines(t *testing.T) {
	p := kingbaseparser.New()
	out, ok := p.FormatDocument("SELECT 1;\n\n\n\nSELECT 2;\n")
	if !ok {
		t.Fatal("format should succeed")
	}
	if strings.Contains(out, "\n\n\n") {
		t.Fatalf("expected collapsed blanks, got %q", out)
	}
}

func TestCompletionInProcedureBodyPrefersKeyword(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PROCEDURE p AS\nBEGIN\n\t"
	cc := p.CompletionContext(sql, sqllsp.Position{Line: 2, Character: 1})
	if len(cc.Expect) == 0 || cc.Expect[0] != sqllsp.KindKeyword {
		t.Fatalf("expect keyword-first in procedure body, got %#v", cc.Expect)
	}
	hasFn, hasRoutine := false, false
	for _, k := range cc.Expect {
		if k == sqllsp.KindFunction {
			hasFn = true
		}
		if k == sqllsp.KindRoutine {
			hasRoutine = true
		}
	}
	if !hasFn || !hasRoutine {
		t.Fatalf("procedure body should expect function+routine, got %#v", cc.Expect)
	}
	if len(cc.Functions) == 0 {
		t.Fatal("expected native builtins in completion context")
	}
}

func TestCompatAutoNoMysqlOracleUnion(t *testing.T) {
	p := kingbaseparser.NewWithCompat(kingbaseparser.CompatAuto)
	kws := p.Keywords()
	for _, bad := range []string{"AUTO_INCREMENT", "ENGINE", "SIGNAL", "PIPELINED", "FORALL"} {
		for _, kw := range kws {
			if strings.EqualFold(kw, bad) {
				t.Fatalf("native mode must not include %s", bad)
			}
		}
	}
	cc := p.CompletionContext("SELECT ", sqllsp.Position{Character: 7})
	for _, fn := range cc.Functions {
		if strings.EqualFold(fn.Label, "IFNULL") || strings.EqualFold(fn.Label, "DATE_FORMAT") || strings.EqualFold(fn.Label, "SYS_CONTEXT") {
			t.Fatalf("native builtins must not include %s", fn.Label)
		}
	}
	if p.BuiltinSignature("IFNULL") != nil {
		t.Fatal("native mode must not expose IFNULL signature")
	}
	if p.BuiltinSignature("NVL") == nil {
		t.Fatal("native mode should expose NVL")
	}
}

func TestCompatMysqlBuiltinsExclusive(t *testing.T) {
	p := kingbaseparser.NewWithCompat(kingbaseparser.CompatMysql)
	if p.BuiltinSignature("IFNULL") == nil {
		t.Fatal("mysql mode should expose IFNULL")
	}
	if p.BuiltinSignature("SYS_CONTEXT") != nil {
		t.Fatal("mysql mode must not expose oracle-only SYS_CONTEXT")
	}
}

func TestUnclosedQQuoteDiagnostic(t *testing.T) {
	p := kingbaseparser.New()
	diags := p.Diagnostics("u", "SELECT q'[abc FROM dual")
	found := false
	for _, d := range diags {
		if strings.Contains(d.Message, "Q-quoted") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected unclosed Q-quote diagnostic, got %#v", diags)
	}
}

func TestQuoteIdentNeedsQuotes(t *testing.T) {
	p := kingbaseparser.New()
	if got := p.QuoteIdent("simple_name"); got != "simple_name" {
		t.Fatalf("got %q", got)
	}
	if got := p.QuoteIdent("odd name"); got != `"odd name"` {
		t.Fatalf("got %q", got)
	}
}

func TestUnclosedControlIfHint(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PROCEDURE p AS\nBEGIN\n\tIF x = 1 THEN\n\t\tNULL;\nEND;\n/"
	diags := p.Diagnostics("u", sql)
	found := false
	for _, d := range diags {
		if strings.Contains(d.Message, "unclosed IF") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected unclosed IF diagnostic, got %#v", diags)
	}
}

func TestWhileLoopDoesNotDoubleNest(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PROCEDURE p AS\nBEGIN\n\tWHILE x < 10 LOOP\n\t\tx := x + 1;\n\tEND LOOP;\n\tNULL;\nEND;\n/"
	diags := p.Diagnostics("u", sql)
	for _, d := range diags {
		if strings.Contains(d.Message, "unclosed") && d.Severity <= 2 {
			t.Fatalf("WHILE…LOOP should be balanced, got %#v", diags)
		}
	}
}

func TestQuotedIdentAtEOFNotUnclosed(t *testing.T) {
	p := kingbaseparser.New()
	for _, sql := range []string{
		`"a"`,
		`SELECT "a"`,
		`END "new_pkg"`,
		`END "new_pkg";`,
		`"DATAHUB_TEST"."new_pkg"`,
	} {
		diags := p.Diagnostics("u", sql)
		for _, d := range diags {
			if strings.Contains(d.Message, "unclosed quoted identifier") {
				t.Fatalf("%q: unexpected unclosed quote diagnostic %#v", sql, diags)
			}
		}
	}
	diags := p.Diagnostics("u", `SELECT "abc FROM dual`)
	found := false
	for _, d := range diags {
		if strings.Contains(d.Message, "unclosed quoted identifier") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected unclosed quoted identifier, got %#v", diags)
	}
}

func TestCreatePackageNoFalseUnclosedQuote(t *testing.T) {
	p := kingbaseparser.New()
	sql := "CREATE OR REPLACE PACKAGE \"DATAHUB_TEST\".\"new_pkg\" AS\n" +
		"  -- package specification\n" +
		"  PROCEDURE hello;\n" +
		"END \"new_pkg\";\n" +
		"/\n" +
		"\n" +
		"CREATE OR REPLACE PACKAGE BODY \"DATAHUB_TEST\".\"new_pkg\" AS\n" +
		"  PROCEDURE hello AS\n" +
		"  BEGIN\n" +
		"    NULL;\n" +
		"  END hello;\n" +
		"END \"new_pkg\";\n" +
		"/\n"
	diags := p.Diagnostics("u", sql)
	for _, d := range diags {
		if d.Severity == 1 {
			t.Fatalf("create package template should not error, got %#v", diags)
		}
	}
}

func TestEmptyDiagnostics(t *testing.T) {
	if got := kingbaseparser.New().Diagnostics("u", " \n\t"); len(got) != 0 {
		t.Fatalf("empty SQL diagnostics = %#v", got)
	}
}

func TestPGKeywordIsolation(t *testing.T) {
	for _, keyword := range kingbaseparser.NewWithCompat(kingbaseparser.CompatPG).Keywords() {
		if strings.EqualFold(keyword, "PIPELINED") || strings.EqualFold(keyword, "AUTO_INCREMENT") {
			t.Fatalf("PG keyword list must not include compatibility keyword %q", keyword)
		}
	}
}

func TestDollarQuotedSplit(t *testing.T) {
	sql := "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$\nBEGIN\nPERFORM ';';\nEND;\n$fn$;\nSELECT 1;"
	spans := kingbaseparser.New().SplitStatements(sql)
	if len(spans) != 2 {
		t.Fatalf("expected function and SELECT statements, got %#v", spans)
	}
}
