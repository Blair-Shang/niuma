//go:build linux

package supervisor

import "syscall"

// unixChildSysProcAttr 在父进程（platform-core）死后让内核杀掉能力服务，
// 避免壳/platform 被杀时留下孤儿 mysql/ssh 进程。
func unixChildSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
}
