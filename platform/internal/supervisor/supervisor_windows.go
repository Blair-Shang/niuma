//go:build windows

package supervisor

import (
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

func hiddenWindowSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{HideWindow: true}
}

// childSysProcAttr 返回拉起能力服务时的进程属性（隐藏控制台）。
func childSysProcAttr() *syscall.SysProcAttr {
	return hiddenWindowSysProcAttr()
}

var procWaitNamedPipeW = windows.NewLazySystemDLL("kernel32.dll").NewProc("WaitNamedPipeW")

// waitNamedPipeAvailable 探测命名管道是否已有可连接的服务端实例。
//
// 使用 WaitNamedPipeW 而不是 DialPipe：探活不占用管道实例，也不会在服务端
// 拉起一条立刻断开的连接。管道不存在时立即返回 false；实例全忙时最多阻塞
// listenProbeMs。此函数不得在已登记服务的 Ensure 热路径上调用。
func waitNamedPipeAvailable(addr string) bool {
	if addr == "" {
		return false
	}
	name, err := windows.UTF16PtrFromString(addr)
	if err != nil {
		return false
	}
	r1, _, _ := procWaitNamedPipeW.Call(uintptr(unsafe.Pointer(name)), uintptr(listenProbeMs))
	return r1 != 0
}
