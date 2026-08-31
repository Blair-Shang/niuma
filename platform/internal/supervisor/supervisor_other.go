//go:build !windows

package supervisor

import (
	"os"
	"syscall"
)

func hiddenWindowSysProcAttr() *syscall.SysProcAttr {
	return nil
}

// childSysProcAttr 返回拉起能力服务时的进程属性。Linux 见 supervisor_linux.go。
func childSysProcAttr() *syscall.SysProcAttr {
	return unixChildSysProcAttr()
}

func waitNamedPipeAvailable(addr string) bool {
	_, err := os.Stat(addr)
	return err == nil
}
