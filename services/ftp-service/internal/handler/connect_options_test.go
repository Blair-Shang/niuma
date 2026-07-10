package handler

import "testing"

func TestConnectOptionsEffectiveTimeoutSeconds(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		opts   ConnectOptions
		want   int
	}{
		{name: "snake_case", opts: ConnectOptions{TimeoutSeconds: 45}, want: 45},
		{name: "camelCase legacy", opts: ConnectOptions{TimeoutSecondsLegacy: 25}, want: 25},
		{name: "snake_case wins", opts: ConnectOptions{TimeoutSeconds: 30, TimeoutSecondsLegacy: 10}, want: 30},
		{name: "unset", opts: ConnectOptions{}, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := tt.opts.effectiveTimeoutSeconds(); got != tt.want {
				t.Fatalf("effectiveTimeoutSeconds() = %d, want %d", got, tt.want)
			}
		})
	}
}
