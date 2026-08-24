package dataio

import (
	"strings"
	"testing"
)

func TestSplitSQLStatementsSkipsSemicolonInLineComment(t *testing.T) {
	script := "-- NiuMa PostgreSQL dump\n" +
		"-- note: no CREATE DATABASE; restore into a prepared target DB\n" +
		"-- note: includes sequences / functions / procedures / triggers when selected\n\n" +
		"SET client_encoding = 'UTF8';\n\n" +
		"CREATE TABLE t (id int);\n"
	got, err := splitSQLStatements(script)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d statements: %#v", len(got), got)
	}
	if got[0] != "SET client_encoding = 'UTF8'" {
		t.Fatalf("statement 0 = %q", got[0])
	}
	if got[1] != "CREATE TABLE t (id int)" {
		t.Fatalf("statement 1 = %q", got[1])
	}
	for _, stmt := range got {
		if strings.Contains(strings.ToLower(stmt), "restore into") {
			t.Fatalf("comment leaked into executable SQL: %q", stmt)
		}
	}
}

func TestSplitSQLStatementsKeepsSemicolonInStringAndDollarQuote(t *testing.T) {
	script := "SELECT 'a;b';\nCREATE FUNCTION f() RETURNS text AS $$ SELECT 'x;y'; $$ LANGUAGE sql;\n"
	got, err := splitSQLStatements(script)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d statements: %#v", len(got), got)
	}
	if got[0] != "SELECT 'a;b'" {
		t.Fatalf("statement 0 = %q", got[0])
	}
	if !strings.Contains(got[1], "SELECT 'x;y';") {
		t.Fatalf("dollar-quote body split incorrectly: %q", got[1])
	}
}

func TestSplitSQLStatementsSkipsSemicolonInBlockComment(t *testing.T) {
	script := "/* drop; restore */\nSELECT 1;\nSELECT 2;\n"
	got, err := splitSQLStatements(script)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d statements: %#v", len(got), got)
	}
	if !strings.HasSuffix(got[0], "SELECT 1") {
		t.Fatalf("statement 0 = %q", got[0])
	}
}
