package handler

import "testing"

func TestConnectOptionsEffectiveKeepaliveSeconds(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		opts ConnectOptions
		want int
	}{
		{name: "set", opts: ConnectOptions{KeepaliveSeconds: 45}, want: 45},
		{name: "unset", opts: ConnectOptions{}, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := tt.opts.effectiveKeepaliveSeconds(); got != tt.want {
				t.Fatalf("effectiveKeepaliveSeconds() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestStopSessionKeepaliveNilSafe(t *testing.T) {
	t.Parallel()
	stopSessionKeepalive(&session{})
}
