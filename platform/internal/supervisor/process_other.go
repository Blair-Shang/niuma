//go:build !windows

package supervisor

import (
	"os"
	"syscall"
)

func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}

// terminateStaleProcessesAtExe 在非 Windows 上为空操作：UDS 文件冲突由监听方覆盖或删除。
func terminateStaleProcessesAtExe(exePath string) {
	_ = exePath
}

func initChildJob() error {
	return nil
}

func assignChildToJob(pid int) error {
	_ = pid
	return nil
}

func closeChildJob() {}
