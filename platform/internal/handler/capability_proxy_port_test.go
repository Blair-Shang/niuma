package handler

import "testing"

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
