package dataio

import (
	"strings"
	"testing"
)

func TestSplitSqlScript_PlainSQL(t *testing.T) {
	t.Parallel()
	got := splitSqlScript("CREATE TABLE t (id INT);\nINSERT INTO t VALUES (1);\n")
	if len(got) != 2 {
		t.Fatalf("len=%d want 2: %#v", len(got), got)
	}
	if !strings.Contains(got[0], "CREATE TABLE") {
		t.Fatalf("stmt0=%q", got[0])
	}
	if !strings.Contains(got[1], "INSERT INTO") {
		t.Fatalf("stmt1=%q", got[1])
	}
}

func TestSplitSqlScript_PlsqlSlash(t *testing.T) {
	t.Parallel()
	src := `
CREATE OR REPLACE PROCEDURE p AS
BEGIN
  NULL;
  INSERT INTO t VALUES (1);
END;
/

CREATE TABLE x (id INT);
`
	got := splitSqlScript(src)
	if len(got) != 2 {
		t.Fatalf("len=%d want 2: %#v", len(got), got)
	}
	if !strings.Contains(got[0], "CREATE OR REPLACE PROCEDURE") {
		t.Fatalf("proc=%q", got[0])
	}
	if !strings.Contains(got[0], "INSERT INTO t") {
		t.Fatalf("proc body lost: %q", got[0])
	}
	if strings.Contains(got[0], "CREATE TABLE") {
		t.Fatalf("proc swallowed table: %q", got[0])
	}
	if !strings.Contains(got[1], "CREATE TABLE") {
		t.Fatalf("table=%q", got[1])
	}
}

func TestSplitSqlScript_PackageSpecAndBody(t *testing.T) {
	t.Parallel()
	src := `
CREATE OR REPLACE PACKAGE pkg AS
  PROCEDURE foo;
END;
/

CREATE OR REPLACE PACKAGE BODY pkg AS
  PROCEDURE foo IS
  BEGIN
    NULL;
  END;
END;
/
`
	got := splitSqlScript(src)
	if len(got) != 2 {
		t.Fatalf("len=%d want 2: %#v", len(got), got)
	}
	if !strings.Contains(strings.ToUpper(got[0]), "PACKAGE PKG") &&
		!strings.Contains(strings.ToUpper(got[0]), "PACKAGE \"PKG\"") {
		// accept PACKAGE pkg AS
		if !strings.Contains(strings.ToUpper(got[0]), "PACKAGE") {
			t.Fatalf("spec=%q", got[0])
		}
	}
	if !strings.Contains(strings.ToUpper(got[1]), "PACKAGE BODY") {
		t.Fatalf("body=%q", got[1])
	}
	// package spec 内部分号不得拆句
	if strings.Contains(got[0], "PACKAGE BODY") {
		t.Fatalf("spec merged with body: %q", got[0])
	}
}

func TestSplitSqlScript_StringSemicolon(t *testing.T) {
	t.Parallel()
	got := splitSqlScript(`INSERT INTO t VALUES ('a;b');`)
	if len(got) != 1 {
		t.Fatalf("len=%d want 1: %#v", len(got), got)
	}
	if !strings.Contains(got[0], "'a;b'") {
		t.Fatalf("got=%q", got[0])
	}
}

func TestLooksLikePlsqlUnit(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want bool
	}{
		{"CREATE TABLE t (id INT)", false},
		{"CREATE OR REPLACE PROCEDURE p AS", true},
		{"-- c\nCREATE FUNCTION f RETURN INT AS", true},
		{"CREATE OR REPLACE PACKAGE BODY p AS", true},
		{"CREATE OR REPLACE TRIGGER tr BEFORE INSERT ON t", true},
		{"DECLARE\n  x INT;", true},
		{"BEGIN\n  NULL;\nEND;", true},
		{"INSERT INTO t VALUES (1)", false},
		{"DROP PROCEDURE p", false},
	}
	for _, tc := range cases {
		if got := looksLikePlsqlUnit(tc.in); got != tc.want {
			t.Fatalf("%q: got %v want %v", tc.in, got, tc.want)
		}
	}
}

func TestEnsureCreateOrReplace(t *testing.T) {
	t.Parallel()
	got := ensureCreateOrReplace("PROCEDURE p AS\nBEGIN\n  NULL;\nEND;", "PROCEDURE")
	if !strings.HasPrefix(strings.ToUpper(got), "CREATE OR REPLACE PROCEDURE") {
		t.Fatalf("got=%q", got)
	}
	got = ensureCreateOrReplace("CREATE PROCEDURE p AS BEGIN NULL; END;", "PROCEDURE")
	if !strings.HasPrefix(strings.ToUpper(got), "CREATE OR REPLACE PROCEDURE") {
		t.Fatalf("got=%q", got)
	}
}

func TestStripSchemaQualifier(t *testing.T) {
	t.Parallel()

	got := stripSchemaQualifier(
		`CREATE TABLE "TEST"."biz" (
  "id" INT
);
INSERT INTO "TEST"."biz" VALUES (1);
SELECT * FROM "TEST"."other"`,
		"TEST",
	)
	want := `CREATE TABLE "biz" (
  "id" INT
);
INSERT INTO "biz" VALUES (1);
SELECT * FROM "other"`
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}

	lit := `INSERT INTO "t" VALUES ('TEST.biz')`
	if stripSchemaQualifier(lit, "TEST") != lit {
		t.Fatal("must not rewrite unquoted schema in literals")
	}

	if stripSchemaQualifier("SELECT 1", "") != "SELECT 1" {
		t.Fatal("empty schema")
	}

	got = stripSchemaQualifier(`CREATE TABLE "A""B"."t" (id INT)`, `A"B`)
	want = `CREATE TABLE "t" (id INT)`
	if got != want {
		t.Fatalf("escaped schema: got %q want %q", got, want)
	}
}
