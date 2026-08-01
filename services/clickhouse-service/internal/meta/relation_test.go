package meta

import "testing"

func TestClassifyObjectType(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"MergeTree":          "table",
		"View":               "view",
		"MaterializedView":   "materialized_view",
		"Dictionary":         "dictionary",
		"ReplacingMergeTree": "table",
	}
	for eng, want := range cases {
		if got := classifyObjectType(eng); got != want {
			t.Fatalf("%q: got %q want %q", eng, got, want)
		}
	}
}

func TestRequireRelation(t *testing.T) {
	t.Parallel()
	if err := requireRelation(RelationRef{}); err == nil {
		t.Fatal("empty must fail")
	}
	if err := requireRelation(RelationRef{Database: "db;x", Name: "t"}); err == nil {
		t.Fatal("unsafe db must fail")
	}
	if err := requireRelation(RelationRef{Database: "default", Name: "events"}); err != nil {
		t.Fatal(err)
	}
}

func TestQualified(t *testing.T) {
	t.Parallel()
	got, err := qualified(RelationRef{Database: "default", Name: "t"})
	if err != nil || got != "`default`.`t`" {
		t.Fatalf("got %q err=%v", got, err)
	}
}

func TestIsUnknownTable(t *testing.T) {
	t.Parallel()
	if !isUnknownTable(errString("Unknown table expression identifier 'data_skipping_indices'")) {
		t.Fatal("expected unknown")
	}
	if isUnknownTable(errString("connection refused")) {
		t.Fatal("other errors")
	}
}

type errString string

func (e errString) Error() string { return string(e) }
