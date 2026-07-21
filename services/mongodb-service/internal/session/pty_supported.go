package session

import (
	"sync"

	gopty "github.com/aymanbagabas/go-pty"
)

var (
	ptySupportedOnce sync.Once
	ptySupported     bool
)

// PtyInteractiveSupported 报告当前平台是否支持交互式 PTY（Unix PTY 或 Windows ConPTY）。
func PtyInteractiveSupported() bool {
	ptySupportedOnce.Do(func() {
		pt, err := gopty.New()
		if err != nil {
			return
		}
		ptySupported = pt.Close() == nil
	})
	return ptySupported
}
