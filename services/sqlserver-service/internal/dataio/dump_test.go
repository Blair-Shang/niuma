package dataio

import (
	"strings"
	"testing"
)

func TestNormalizeDumpParamsLeavesSchemaEmpty(t *testing.T) {
	t.Parallel()
	p := DumpParams{Mode: DumpStructureOnly}
	normalizeDumpParams(&p)
	if p.Schema != "" {
		t.Fatalf("empty schema must stay empty for database dump, got %q", p.Schema)
	}
	if !p.IncludeTables || !p.IncludeViews {
		t.Fatalf("default includes: tables=%v views=%v", p.IncludeTables, p.IncludeViews)
	}

	p = DumpParams{Schema: "  sales  "}
	normalizeDumpParams(&p)
	if p.Schema != "sales" {
		t.Fatalf("schema trim: %q", p.Schema)
	}
}

func TestDumpWantFlagsDefaultTrue(t *testing.T) {
	t.Parallel()
	var p DumpParams
	if !dumpWantCreateSchema(p) || !dumpWantExcludeSystem(p) {
		t.Fatal("nil flags should default true")
	}
	f := false
	p.CreateSchema = &f
	p.ExcludeSystem = &f
	if dumpWantCreateSchema(p) || dumpWantExcludeSystem(p) {
		t.Fatal("explicit false must win")
	}
}

func TestDumpSchemaHeaderFields(t *testing.T) {
	t.Parallel()
	field, line := dumpSchemaHeaderFields(DumpParams{Schema: "dbo"}, []string{"dbo"})
	if field != "dbo" || line != "" {
		t.Fatalf("single schema: field=%q line=%q", field, line)
	}
	field, line = dumpSchemaHeaderFields(DumpParams{}, []string{"dbo", "sales"})
	if field != "*" {
		t.Fatalf("database dump schema field: %q", field)
	}
	if !strings.Contains(line, "dbo, sales") {
		t.Fatalf("schemas line: %q", line)
	}
}

func TestShouldEmitCreateSchema(t *testing.T) {
	t.Parallel()
	if shouldEmitCreateSchema("dbo") || shouldEmitCreateSchema("sys") || shouldEmitCreateSchema("db_owner") {
		t.Fatal("dbo / system schemas must not emit CREATE SCHEMA")
	}
	if !shouldEmitCreateSchema("sales") {
		t.Fatal("user schema should emit CREATE SCHEMA")
	}
	if hasCreatableSchema([]string{"dbo", "sys"}) {
		t.Fatal("only system/dbo is not creatable")
	}
	if !hasCreatableSchema([]string{"dbo", "sales"}) {
		t.Fatal("sales is creatable")
	}
}

func TestCreateSchemaBlock(t *testing.T) {
	t.Parallel()
	got := createSchemaBlock("sales")
	if !strings.Contains(got, "SCHEMA_ID(N'sales')") {
		t.Fatalf("missing SCHEMA_ID: %s", got)
	}
	if !strings.Contains(got, "CREATE SCHEMA [sales]") {
		t.Fatalf("missing CREATE SCHEMA: %s", got)
	}
	if !strings.Contains(got, "\nGO\n") {
		t.Fatalf("CREATE SCHEMA must be its own batch: %s", got)
	}
	got = createSchemaBlock("o'brien")
	if !strings.Contains(got, "SCHEMA_ID(N'o''brien')") {
		t.Fatalf("literal escape: %s", got)
	}
}

func TestIncludeDumpKind(t *testing.T) {
	t.Parallel()
	p := DumpParams{IncludeTables: true, IncludeViews: true}
	if !includeDumpKind(p, "table") || !includeDumpKind(p, "view") {
		t.Fatal("table/view should be included")
	}
	if includeDumpKind(p, "procedure") || includeDumpKind(p, "trigger") {
		t.Fatal("unselected kinds must be excluded")
	}
}
