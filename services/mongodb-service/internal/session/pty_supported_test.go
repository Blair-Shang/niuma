package session

import (
	"runtime"
	"testing"
)

func TestPtyInteractiveSupported(t *testing.T) {
	supported := PtyInteractiveSupported()
	if runtime.GOOS == "windows" || runtime.GOOS == "linux" || runtime.GOOS == "darwin" {
		if !supported {
			t.Fatalf("expected PTY support on %s", runtime.GOOS)
		}
	}
}
