package supervisor

import (
	"os/exec"
	"testing"
)

// TestIsTrackedReady_Empty 未拉起任何服务时不得走热路径，否则会跳过真正的 spawn。
func TestIsTrackedReady_Empty(t *testing.T) {
	s := &Supervisor{
		spawned:             make(map[string]*exec.Cmd),
		spawnEnvFingerprint: make(map[string]string),
	}
	if s.isTrackedReady("com.niuma.sqlite", "") {
		t.Fatal("empty supervisor must not report ready")
	}
}

// TestIsTrackedReady_ShuttingDown 退出过程中不得把已死进程当成仍可用。
func TestIsTrackedReady_ShuttingDown(t *testing.T) {
	s := &Supervisor{
		shuttingDown:        true,
		spawned:             make(map[string]*exec.Cmd),
		spawnEnvFingerprint: make(map[string]string),
	}
	if s.isTrackedReady("com.niuma.sqlite", "") {
		t.Fatal("shutting down supervisor must not report ready")
	}
}
