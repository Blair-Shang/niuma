package ai

import "testing"

func TestIsSystemProviderID(t *testing.T) {
	if !IsSystemProviderID("niuma-system") {
		t.Fatal("expected system id")
	}
	if IsSystemProviderID("openai") {
		t.Fatal("user provider")
	}
}
