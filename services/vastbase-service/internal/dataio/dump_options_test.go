package dataio

import (
	"strings"
	"testing"
)

func TestNormalizeDumpParamsDefaults(t *testing.T) {
	p := DumpParams{}
	normalizeDumpParams(&p)
	if p.Mode != DumpStructureAndData {
		t.Fatalf("mode=%s", p.Mode)
	}
	if !p.IncludeTables || !p.IncludeViews || !p.IncludeMatViews {
		t.Fatalf("object defaults: %+v", p)
	}
}

func TestDumpRelationTypes(t *testing.T) {
	p := DumpParams{IncludeTables: true, IncludeMatViews: true}
	got := dumpRelationTypes(p)
	if len(got) != 2 || got[0] != "table" || got[1] != "materialized_view" {
		t.Fatalf("%v", got)
	}
}

func TestWriteDropStatementsOrder(t *testing.T) {
	var buf strings.Builder
	w := &countingWriter{w: &buf}
	targets := []dumpTarget{
		{Schema: "public", Name: "parent", Type: "table"},
		{Schema: "public", Name: "child", Type: "table"},
		{Schema: "public", Name: "v1", Type: "view"},
	}
	if err := writeDropStatements(w, targets); err != nil {
		t.Fatal(err)
	}
	s := buf.String()
	if !strings.Contains(s, `DROP VIEW IF EXISTS "public"."v1" CASCADE`) {
		t.Fatalf("missing view drop: %s", s)
	}
	vi := strings.Index(s, `DROP VIEW`)
	ci := strings.Index(s, `DROP TABLE IF EXISTS "public"."child"`)
	pi := strings.Index(s, `DROP TABLE IF EXISTS "public"."parent"`)
	if vi < 0 || ci < 0 || pi < 0 || !(vi < ci && ci < pi) {
		t.Fatalf("drop order wrong: view=%d child=%d parent=%d\n%s", vi, ci, pi, s)
	}
}

func TestDumpWantDefaults(t *testing.T) {
	p := DumpParams{}
	if !dumpWantCreateSchema(p) || !dumpWantExcludeSystem(p) {
		t.Fatal("expected true defaults")
	}
	f := false
	p.CreateSchema = &f
	p.ExcludeSystem = &f
	if dumpWantCreateSchema(p) || dumpWantExcludeSystem(p) {
		t.Fatal("expected false when set")
	}
}
