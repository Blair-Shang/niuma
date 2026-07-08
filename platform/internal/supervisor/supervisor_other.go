//go:build !windows

package supervisor

import (
	"os"
	"syscall"
)

func hiddenWindowSysProcAttr() *syscall.SysProcAttr {
	return nil
}

func waitNamedPipeAvailable(addr string) bool {
	_, err := os.Stat(addr)
	return err == nil
}
