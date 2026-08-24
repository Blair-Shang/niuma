package meta

import (
	"strings"
	"testing"
)

func TestFormatDataType(t *testing.T) {
	cases := []struct {
		typ           string
		max, prec, sc int32
		want          string
	}{
		{"nvarchar", 100, 0, 0, "nvarchar(50)"},
		{"nvarchar", -1, 0, 0, "nvarchar(max)"},
		{"varchar", 32, 0, 0, "varchar(32)"},
		{"decimal", 0, 18, 2, "decimal(18,2)"},
		{"int", 4, 10, 0, "int"},
		{"datetime2", 0, 0, 3, "datetime2(3)"},
	}
	for _, tc := range cases {
		got := FormatDataType(tc.typ, tc.max, tc.prec, tc.sc)
		if got != tc.want {
			t.Fatalf("FormatDataType(%q,%d,%d,%d)=%q want %q", tc.typ, tc.max, tc.prec, tc.sc, got, tc.want)
		}
	}
}

func TestAssembleTableDDL(t *testing.T) {
	def := "(0)"
	ddl := AssembleTableDDL(
		RelationRef{Schema: "dbo", Name: "T"},
		[]ColumnInfo{
			{Name: "Id", DataType: "int", AutoIncrement: true, IdentitySeed: "1", IdentityIncr: "1", Nullable: false},
			{Name: "Name", DataType: "nvarchar(64)", Nullable: false},
			{Name: "Flag", DataType: "bit", Nullable: true, Default: &def},
		},
		[]IndexInfo{
			{Name: "PK_T", Primary: true, Unique: true, Columns: []string{"Id"}},
		},
		"demo",
	)
	for _, want := range []string{
		"CREATE TABLE [dbo].[T]",
		"[Id] int IDENTITY(1, 1) NOT NULL",
		"[Name] nvarchar(64) NOT NULL",
		"DEFAULT (0)",
		"CONSTRAINT [PK_T] PRIMARY KEY ([Id])",
		"-- demo",
	} {
		if !strings.Contains(ddl, want) {
			t.Fatalf("missing %q in:\n%s", want, ddl)
		}
	}
}

func TestQuoteIdent(t *testing.T) {
	got, err := QuoteIdent("a]b")
	if err != nil {
		t.Fatal(err)
	}
	if got != "[a]]b]" {
		t.Fatalf("got %q", got)
	}
}
