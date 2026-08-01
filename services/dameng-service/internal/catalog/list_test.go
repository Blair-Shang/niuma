package catalog

import "testing"

func TestNormalizeLimit(t *testing.T) {
	if normalizeLimit(0) != DefaultLimit {
		t.Fatalf("default: got %d", normalizeLimit(0))
	}
	if normalizeLimit(MaxLimit+10) != MaxLimit {
		t.Fatalf("max: got %d", normalizeLimit(MaxLimit+10))
	}
	if normalizeLimit(50) != 50 {
		t.Fatalf("passthrough: got %d", normalizeLimit(50))
	}
}
