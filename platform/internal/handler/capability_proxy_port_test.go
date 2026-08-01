package handler

import (
	"encoding/json"
	"testing"
)

func TestNormalizeInlinePort(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		overridePort int
		profilePort  int
		want         int
	}{
		{name: "explicit override", overridePort: 2222, profilePort: 22, want: 2222},
		{name: "fallback profile", overridePort: 0, profilePort: 22, want: 22},
		{name: "defer to service default", overridePort: 0, profilePort: 0, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := normalizeInlinePort(tt.overridePort, tt.profilePort); got != tt.want {
				t.Fatalf("normalizeInlinePort(%d, %d) = %d, want %d", tt.overridePort, tt.profilePort, got, tt.want)
			}
		})
	}
}

func TestOverrideOptionsDatabase(t *testing.T) {
	t.Parallel()

	t.Run("empty override keeps options", func(t *testing.T) {
		t.Parallel()
		in := json.RawMessage(`{"database":"TEST","ssl_mode":"prefer"}`)
		got, err := overrideOptionsDatabase(in, "  ")
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(in) {
			t.Fatalf("got %s", got)
		}
	})

	t.Run("overrides existing database", func(t *testing.T) {
		t.Parallel()
		got, err := overrideOptionsDatabase(json.RawMessage(`{"database":"TEST","ssl_mode":"prefer"}`), "wms_dev")
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if err := json.Unmarshal(got, &m); err != nil {
			t.Fatal(err)
		}
		if m["database"] != "wms_dev" {
			t.Fatalf("database=%v", m["database"])
		}
		if m["ssl_mode"] != "prefer" {
			t.Fatalf("ssl_mode=%v", m["ssl_mode"])
		}
	})

	t.Run("creates options when null", func(t *testing.T) {
		t.Parallel()
		got, err := overrideOptionsDatabase(json.RawMessage("null"), "wms_dev")
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if err := json.Unmarshal(got, &m); err != nil {
			t.Fatal(err)
		}
		if m["database"] != "wms_dev" {
			t.Fatalf("database=%v", m["database"])
		}
	})
}
