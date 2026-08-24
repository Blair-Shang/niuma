package meta

import "testing"

func TestKindFromSysType(t *testing.T) {
	cases := map[string]string{
		"P":  "procedure",
		"pc": "procedure",
		"FN": "function",
		"IF": "function",
		"TF": "function",
		"V":  "view",
		"SO": "sequence",
		"U":  "",
	}
	for typ, want := range cases {
		if got := KindFromSysType(typ); got != want {
			t.Fatalf("KindFromSysType(%q)=%q want %q", typ, got, want)
		}
	}
}

func TestIsTableValuedSysType(t *testing.T) {
	if !IsTableValuedSysType("IF") || !IsTableValuedSysType("tf") || !IsTableValuedSysType("FT") {
		t.Fatal("IF/TF/FT should be table-valued")
	}
	if IsTableValuedSysType("FN") || IsTableValuedSysType("P") {
		t.Fatal("FN/P should not be table-valued")
	}
}

func TestParameterDtdIdentifier(t *testing.T) {
	if got := ParameterDtdIdentifier("dbo", "MyType", 0, 0, 0, true); got != "[dbo].[MyType]" {
		t.Fatalf("table type: got %q", got)
	}
	if got := ParameterDtdIdentifier("", "nvarchar", 20, 0, 0, false); got != "nvarchar(10)" {
		t.Fatalf("nvarchar: got %q", got)
	}
	if got := ParameterDtdIdentifier("", "int", 4, 10, 0, false); got != "int" {
		t.Fatalf("int: got %q", got)
	}
}

func TestAssembleSequenceDDL(t *testing.T) {
	got := AssembleSequenceDDL(
		RelationRef{Schema: "dbo", Name: "Seq"},
		SequenceInfo{
			DataType:  "bigint",
			Start:     "1",
			Increment: "1",
			MinValue:  "1",
			MaxValue:  "999",
			Cycle:     false,
			Cached:    true,
			CacheSize: 50,
		},
	)
	want := "CREATE SEQUENCE [dbo].[Seq]\n  AS bigint\n  START WITH 1\n  INCREMENT BY 1\n  MINVALUE 1\n  MAXVALUE 999\n  NO CYCLE\n  CACHE 50\n"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}
