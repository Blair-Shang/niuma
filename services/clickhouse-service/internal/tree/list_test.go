package tree

import "testing"

func TestClassifyEngine(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"MergeTree":        TypeTable,
		"View":             TypeView,
		"MaterializedView": TypeMaterializedView,
		"Dictionary":       TypeDictionary,
		"ReplacingMergeTree": TypeTable,
	}
	for eng, want := range cases {
		if got := classifyEngine(eng); got != want {
			t.Fatalf("engine %q: got %q want %q", eng, got, want)
		}
	}
}

func TestNormalizeObjectTypesDefault(t *testing.T) {
	t.Parallel()
	want := normalizeObjectTypes(nil)
	if !want[TypeTable] || !want[TypeView] || !want[TypeMaterializedView] {
		t.Fatalf("%v", want)
	}
	if want[TypeDictionary] {
		t.Fatal("default types must not include dictionary (separate RPC)")
	}
}

func TestIsSystemDatabase(t *testing.T) {
	t.Parallel()
	if !IsSystemDatabase("system") || !IsSystemDatabase("INFORMATION_SCHEMA") {
		t.Fatal("system dbs")
	}
	if IsSystemDatabase("default") || IsSystemDatabase("analytics") {
		t.Fatal("user dbs must not be system")
	}
}

func TestLikePrefix(t *testing.T) {
	t.Parallel()
	if got := likePrefix("ab_c"); got != `ab\_c%` {
		t.Fatalf("got %q", got)
	}
	if likePrefix("  ") != "" {
		t.Fatal("blank")
	}
}

func TestNormalizeLimit(t *testing.T) {
	t.Parallel()
	if normalizeLimit(0) != DefaultLimit {
		t.Fatal("default")
	}
	if normalizeLimit(MaxLimit+10) != MaxLimit {
		t.Fatal("max")
	}
}
