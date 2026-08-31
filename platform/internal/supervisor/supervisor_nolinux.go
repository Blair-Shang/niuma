//go:build !windows && !linux

package supervisor

import "syscall"

// unixChildSysProcAttr 在 macOS 等无 PDEATHSIG 的平台上不设额外属性。
func unixChildSysProcAttr() *syscall.SysProcAttr {
	return nil
}
