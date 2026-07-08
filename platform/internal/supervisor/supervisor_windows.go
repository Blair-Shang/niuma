//go:build windows

package supervisor

import (
	"syscall"
	"time"

	"github.com/Microsoft/go-winio"
)

func hiddenWindowSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{HideWindow: true}
}

// waitNamedPipeAvailable 探测命名管道是否已有服务端实例。
func waitNamedPipeAvailable(addr string) bool {
	timeout := time.Duration(listenProbeMs) * time.Millisecond
	conn, err := winio.DialPipe(addr, &timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
