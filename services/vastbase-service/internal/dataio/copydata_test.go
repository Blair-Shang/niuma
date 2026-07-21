package dataio

import (
	"bufio"
	"io"
	"strings"
	"testing"
)

func TestIsCopyFromStdin(t *testing.T) {
	cases := []struct {
		sql  string
		want bool
	}{
		{`COPY "public"."t" FROM STDIN WITH (FORMAT csv, HEADER true)`, true},
		{`copy public.t from stdin`, true},
		{`COPY public.t TO STDOUT`, false},
		{`CREATE TABLE t (id int)`, false},
		{`SELECT * FROM stdin_table`, false},
	}
	for _, tc := range cases {
		if got := isCopyFromStdin(tc.sql); got != tc.want {
			t.Fatalf("isCopyFromStdin(%q)=%v want %v", tc.sql, got, tc.want)
		}
	}
}

func TestCopyDataReader(t *testing.T) {
	raw := "id,name\n1,a\n2,b\n\\.\nCREATE TABLE x(id int);\n"
	br := bufio.NewReader(strings.NewReader(raw))
	r := &copyDataReader{br: br}

	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	want := "id,name\n1,a\n2,b\n"
	if string(got) != want {
		t.Fatalf("payload=%q want %q", got, want)
	}
	if r.consumed() != int64(len(want)+len("\\.\n")) {
		t.Fatalf("consumed=%d", r.consumed())
	}

	rest, err := io.ReadAll(br)
	if err != nil {
		t.Fatal(err)
	}
	if string(rest) != "CREATE TABLE x(id int);\n" {
		t.Fatalf("rest=%q", rest)
	}
}

func TestCopyDataReaderEmpty(t *testing.T) {
	br := bufio.NewReader(strings.NewReader("\\.\n"))
	r := &copyDataReader{br: br}
	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %q", got)
	}
}

func TestTopoSortTables(t *testing.T) {
	tables := []dumpTarget{
		{Schema: "public", Name: "child", Type: "table"},
		{Schema: "public", Name: "parent", Type: "table"},
		{Schema: "public", Name: "lonely", Type: "table"},
	}
	edges := [][2]string{
		{"public.parent", "public.child"},
	}
	out := topoSortTables(tables, edges)
	if len(out) != 3 {
		t.Fatalf("len=%d", len(out))
	}
	names := []string{out[0].Name, out[1].Name, out[2].Name}
	// parent before child; lonely keeps relative position among zero-indegree (child has indeg 1)
	if names[0] != "parent" && names[1] != "parent" {
		t.Fatalf("parent should appear early: %v", names)
	}
	pi, ci := -1, -1
	for i, n := range names {
		if n == "parent" {
			pi = i
		}
		if n == "child" {
			ci = i
		}
	}
	if pi < 0 || ci < 0 || pi > ci {
		t.Fatalf("parent must precede child: %v", names)
	}
}

func TestOrderDumpTargetsViewsLast(t *testing.T) {
	targets := []dumpTarget{
		{Schema: "public", Name: "v1", Type: "view"},
		{Schema: "public", Name: "t1", Type: "table"},
	}
	// no pool needed when only one table
	out, err := orderDumpTargets(nil, nil, targets)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].Name != "t1" || out[1].Name != "v1" {
		t.Fatalf("got %+v", out)
	}
}

func TestIsCopyFromStdinWithDataComment(t *testing.T) {
	sql := "-- Data: public.t\nCOPY \"public\".\"t\" FROM STDIN WITH (FORMAT csv, HEADER true)"
	if !isCopyFromStdin(sql) {
		t.Fatal("expected true")
	}
	if stripSQLLeadingComments(sql) != `COPY "public"."t" FROM STDIN WITH (FORMAT csv, HEADER true)` {
		t.Fatalf("strip=%q", stripSQLLeadingComments(sql))
	}
}
