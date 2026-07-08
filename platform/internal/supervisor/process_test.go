package supervisor

import (
	"os/exec"
	"runtime"
	"testing"
	"time"
)

func TestIsProcessAlive(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only")
	}
	cmd := exec.Command("cmd", "/c", "timeout", "/t", "2", "/nobreak")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pid := cmd.Process.Pid
	if !isProcessAlive(pid) {
		t.Fatalf("expected pid %d alive", pid)
	}
	_ = cmd.Process.Kill()
	_, _ = cmd.Process.Wait()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !isProcessAlive(pid) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected pid %d dead", pid)
}

func TestWatchChildClearsSpawned(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows only")
	}
	sup := &Supervisor{spawned: make(map[string]*exec.Cmd)}
	cmd := exec.Command("cmd", "/c", "exit", "0")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	sup.spawned["test"] = cmd
	sup.watchChild("test", cmd)
	if _, ok := sup.spawned["test"]; ok {
		t.Fatal("spawned map should be cleared after exit")
	}
}
