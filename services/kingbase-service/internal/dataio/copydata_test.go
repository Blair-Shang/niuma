package dataio

import (
	"bufio"
	"io"
	"strings"
	"testing"
)

func TestCopyPayloadSkipsNewlineAfterCopyStmt(t *testing.T) {
	script := "-- Data: public.test\n" +
		`COPY "public"."test" FROM STDIN WITH (FORMAT csv, HEADER true);` + "\n" +
		"a11,created_at,col_3\n" +
		"test,2026-08-24 06:54:25.799389,\n" +
		"\\.\n" +
		"CREATE VIEW v AS SELECT 1;\n"

	s := newSQLStmtScanner(bufio.NewReader(strings.NewReader(script)))
	stmt, err := s.next()
	if err != nil {
		t.Fatal(err)
	}
	if !isCopyFromStdin(stmt) {
		t.Fatalf("stmt=%q", stmt)
	}
	skipped := skipCopyStmtLineEnding(s.reader)
	if skipped != 1 {
		t.Fatalf("skipped=%d want 1", skipped)
	}
	payload, err := io.ReadAll(&copyDataReader{br: s.reader})
	if err != nil {
		t.Fatal(err)
	}
	got := string(payload)
	if strings.HasPrefix(got, "\n") || strings.HasPrefix(got, "\r") {
		t.Fatalf("payload starts with line ending: %q", got)
	}
	if !strings.HasPrefix(got, "a11,created_at") {
		t.Fatalf("payload=%q", got)
	}

	rest, err := s.next()
	if err != nil {
		t.Fatal(err)
	}
	if rest != "CREATE VIEW v AS SELECT 1" {
		t.Fatalf("rest=%q", rest)
	}
}

func TestSkipCopyStmtLineEndingCRLF(t *testing.T) {
	br := bufio.NewReader(strings.NewReader("\r\na11,created_at\n"))
	if n := skipCopyStmtLineEnding(br); n != 2 {
		t.Fatalf("skipped=%d want 2", n)
	}
	line, err := br.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if line != "a11,created_at\n" {
		t.Fatalf("line=%q", line)
	}
}
