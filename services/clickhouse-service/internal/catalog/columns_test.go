package catalog

import "testing"

func TestNormalizeLimit(t *testing.T) {
	t.Parallel()
	if normalizeLimit(0) != DefaultLimit {
		t.Fatal("default")
	}
	if normalizeLimit(MaxLimit+1) != MaxLimit {
		t.Fatal("max")
	}
	if normalizeLimit(50) != 50 {
		t.Fatal("passthrough")
	}
}
