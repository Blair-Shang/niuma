package dataio

import "testing"

func TestTopoSortTablesCycleKeepsRemainder(t *testing.T) {
	tables := []dumpTarget{
		{Schema: "public", Name: "a", Type: "table"},
		{Schema: "public", Name: "b", Type: "table"},
	}
	edges := [][2]string{
		{"public.a", "public.b"},
		{"public.b", "public.a"},
	}
	out := topoSortTables(tables, edges)
	if len(out) != 2 {
		t.Fatalf("len=%d", len(out))
	}
	seen := map[string]bool{}
	for _, t0 := range out {
		seen[t0.Name] = true
	}
	if !seen["a"] || !seen["b"] {
		t.Fatalf("missing nodes: %+v", out)
	}
}
