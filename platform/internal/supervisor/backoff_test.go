package supervisor

import (
	"testing"
	"time"
)

func TestNextRestartDelay(t *testing.T) {
	t.Parallel()
	if got := nextRestartDelay(0, 0); got != minRestartDelay {
		t.Fatalf("empty prev = %v, want %v", got, minRestartDelay)
	}
	if got := nextRestartDelay(time.Second, 2*time.Second); got != 2*time.Second {
		t.Fatalf("double = %v", got)
	}
	if got := nextRestartDelay(maxRestartDelay, time.Second); got != maxRestartDelay {
		t.Fatalf("cap = %v", got)
	}
	if got := nextRestartDelay(maxRestartDelay, restartStableAfter); got != minRestartDelay {
		t.Fatalf("stable reset = %v", got)
	}
}
