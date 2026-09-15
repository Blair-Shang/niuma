package meta

import "testing"

func TestCharsetFromCollation(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"", ""},
		{"utf8mb4_unicode_ci", "utf8mb4"},
		{"utf8mb4_0900_ai_ci", "utf8mb4"},
		{"utf8_general_ci", "utf8"},
		{"latin1_swedish_ci", "latin1"},
		{"binary", "binary"},
	}
	for _, tt := range tests {
		if got := charsetFromCollation(tt.in); got != tt.want {
			t.Fatalf("charsetFromCollation(%q)=%q want %q", tt.in, got, tt.want)
		}
	}
}

func TestCatalogObjectKind(t *testing.T) {
	if catalogObjectKind(nil) != "table" {
		t.Fatal("empty types should default to table")
	}
	if catalogObjectKind([]string{"VIEW"}) != "view" {
		t.Fatal("VIEW should map to view")
	}
	if catalogObjectKind([]string{"function"}) != "function" {
		t.Fatal("function kind")
	}
}

func TestTruncateCatalog(t *testing.T) {
	items := make([]ObjectCatalogItem, 3)
	res := truncateCatalog(items, 2)
	if !res.Truncated || len(res.Items) != 2 {
		t.Fatalf("truncated=%v len=%d", res.Truncated, len(res.Items))
	}
}
